import { Order, OrderStatus } from "../../db/types";
import { EventStore } from "../events/event-store";
import { LedgerService } from "../ledger/ledger.service";
import { isValidTransition } from "../events/event-types";
import { toDecimal, calculateFee, formatAmount } from "../../lib/decimal";
import {
  OrderNotFoundError,
  VersionConflictError,
  InvalidTransitionError,
} from "../../lib/errors";

export class OrderService {
  constructor(
    private readonly db: any,
    private readonly eventStore: EventStore,
    private readonly ledger: LedgerService,
  ) {}

  async recordOrder(params: {
    orderId: string;
    customerId: string;
    amount: string;
    paymentMethod: string;
    idempotencyKey: string;
  }): Promise<Order> {
    const { orderId, customerId, amount, paymentMethod, idempotencyKey } =
      params;
    const amountDecimal = toDecimal(amount);

    return this.db.$transaction(async (tx: any) => {
      const existingEvent = await tx.eventLog.findUnique({
        where: { idempotencyKey },
      });
      if (existingEvent)
        return tx.order.findUniqueOrThrow({ where: { id: orderId } });

      const order = await tx.order.create({
        data: {
          id: orderId,
          customerId,
          amount: amountDecimal.toFixed(4),
          paymentMethod,
          status: "PENDING",
          version: 0,
        },
      });

      await this.eventStore.append(tx, {
        aggregateId: orderId,
        eventType: "OrderCreated",
        payload: {
          type: "OrderCreated",
          amount: formatAmount(amountDecimal),
          customerId,
          paymentMethod,
        },
        idempotencyKey,
        expectedVersion: -1,
      });

      await this.ledger.recordDoubleEntry(tx, {
        orderId,
        debitAccount: "order_balance",
        creditAccount: "order_pending",
        amount: amountDecimal,
        description: "Order created",
      });

      return order;
    });
  }

  async recordPayment(params: {
    orderId: string;
    amount: string;
    chargeId: string;
    idempotencyKey: string;
  }): Promise<Order> {
    const { orderId, amount, chargeId, idempotencyKey } = params;
    const amountDecimal = toDecimal(amount);

    return this.db.$transaction(async (tx: any) => {
      const existingEvent = await tx.eventLog.findUnique({
        where: { idempotencyKey },
      });
      if (existingEvent)
        return tx.order.findUniqueOrThrow({ where: { id: orderId } });

      const order: Order | null = await tx.order.findUnique({
        where: { id: orderId },
      });
      if (!order) throw new OrderNotFoundError(orderId);

      if (!isValidTransition(order.status, "PAYMENT_CONFIRMED")) {
        throw new InvalidTransitionError(order.status, "PAYMENT_CONFIRMED");
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version },
        data: { status: "PAYMENT_CONFIRMED", version: { increment: 1 } },
      });
      if (updated.count === 0) throw new VersionConflictError(orderId);

      await this.eventStore.append(tx, {
        aggregateId: orderId,
        eventType: "PaymentConfirmed",
        payload: {
          type: "PaymentConfirmed",
          chargeId,
          amount: formatAmount(amountDecimal),
        },
        idempotencyKey,
        expectedVersion: order.version,
      });

      await this.ledger.recordDoubleEntry(tx, {
        orderId,
        debitAccount: "payment_received",
        creditAccount: "order_balance",
        amount: amountDecimal,
        description: `Payment confirmed - charge ${chargeId}`,
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async calculateFees(params: {
    orderId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<Order> {
    const { orderId, amount, idempotencyKey } = params;
    const amountDecimal = toDecimal(amount);
    const feeAmount = calculateFee(amountDecimal);

    return this.db.$transaction(async (tx: any) => {
      const existingEvent = await tx.eventLog.findUnique({
        where: { idempotencyKey },
      });
      if (existingEvent)
        return tx.order.findUniqueOrThrow({ where: { id: orderId } });

      const order: Order | null = await tx.order.findUnique({
        where: { id: orderId },
      });
      if (!order) throw new OrderNotFoundError(orderId);

      if (!isValidTransition(order.status, "FEE_CALCULATED")) {
        throw new InvalidTransitionError(order.status, "FEE_CALCULATED");
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version },
        data: { status: "FEE_CALCULATED", version: { increment: 1 } },
      });
      if (updated.count === 0) throw new VersionConflictError(orderId);

      await this.eventStore.append(tx, {
        aggregateId: orderId,
        eventType: "FeeCalculated",
        payload: {
          type: "FeeCalculated",
          fee: formatAmount(feeAmount),
          rate: "0.03",
        },
        idempotencyKey,
        expectedVersion: order.version,
      });

      await this.ledger.recordDoubleEntry(tx, {
        orderId,
        debitAccount: "fees_owed",
        creditAccount: "payment_received",
        amount: feeAmount,
        description: `Fee 3% of ${formatAmount(amountDecimal)}`,
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async findById(orderId: string): Promise<Order> {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }

  async markShipped(params: {
    orderId: string;
    trackingNumber: string;
    idempotencyKey: string;
  }): Promise<Order> {
    const { orderId, trackingNumber, idempotencyKey } = params;

    return this.db.$transaction(async (tx: any) => {
      const existingEvent = await tx.eventLog.findUnique({
        where: { idempotencyKey },
      });
      if (existingEvent)
        return tx.order.findUniqueOrThrow({ where: { id: orderId } });

      const order: Order | null = await tx.order.findUnique({
        where: { id: orderId },
      });
      if (!order) throw new OrderNotFoundError(orderId);

      if (!isValidTransition(order.status, "SHIPPED")) {
        throw new InvalidTransitionError(order.status, "SHIPPED");
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version },
        data: { status: "SHIPPED", version: { increment: 1 } },
      });
      if (updated.count === 0) throw new VersionConflictError(orderId);

      await this.eventStore.append(tx, {
        aggregateId: orderId,
        eventType: "OrderShipped",
        payload: { type: "OrderShipped", trackingNumber },
        idempotencyKey,
        expectedVersion: order.version,
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }
}
