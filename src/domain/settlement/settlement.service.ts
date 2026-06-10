import { EventStore } from "../events/event-store";
import { LedgerService } from "../ledger/ledger.service";
import { toDecimal, formatAmount } from "../../lib/decimal";
import Decimal from "decimal.js";

export interface SettlementResult {
  date: string;
  totalOrders: number;
  totalRevenue: string;
  totalFees: string;
  totalPayout: string;
  idempotent: boolean;
}

export class SettlementService {
  constructor(
    private readonly db: any,
    private readonly eventStore: EventStore,
    private readonly ledger: LedgerService,
  ) {}

  async settle(date: string): Promise<SettlementResult> {
    const idempotencyKey = `settlement-${date}`;

    const existingSettlement = await this.db.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingSettlement) {
      const payload = existingSettlement.payload as Record<string, string>;
      return {
        date,
        totalOrders: parseInt(payload["totalOrders"] ?? "0"),
        totalRevenue: payload["totalRevenue"] ?? "0.0000",
        totalFees: payload["totalFees"] ?? "0.0000",
        totalPayout: payload["totalPayout"] ?? "0.0000",
        idempotent: true,
      };
    }

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const orders = await this.db.order.findMany({
      where: {
        status: { in: ["FEE_CALCULATED", "SHIPPED", "DELIVERED"] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    if (orders.length === 0) {
      return {
        date,
        totalOrders: 0,
        totalRevenue: "0.0000",
        totalFees: "0.0000",
        totalPayout: "0.0000",
        idempotent: false,
      };
    }

    let totalRevenue = new Decimal(0);
    let totalFees = new Decimal(0);
    let totalPayout = new Decimal(0);

    for (const order of orders) {
      const pending = await this.ledger.calculatePendingPayout(order.id);
      const orderAmount = toDecimal(order.amount.toString());
      const feeAmount = orderAmount.mul("0.03").toDecimalPlaces(4);
      totalRevenue = totalRevenue.add(orderAmount);
      totalFees = totalFees.add(feeAmount);
      totalPayout = totalPayout.add(pending);
    }

    await this.db.$transaction(async (tx: any) => {
      const eventLogData = {
        aggregateId: `settlement-${date}`,
        eventType: "SettlementProcessed",
        payload: {
          type: "SettlementProcessed",
          date,
          totalOrders: String(orders.length),
          totalRevenue: formatAmount(totalRevenue),
          totalFees: formatAmount(totalFees),
          totalPayout: formatAmount(totalPayout),
        },
        version: 1,
        idempotencyKey,
      };

      await tx.eventLog.upsert({
        where: { idempotencyKey: idempotencyKey },
        update: {},
        create: eventLogData,
      });

      if (totalPayout.gt(0)) {
        for (const order of orders) {
          const payout = await this.ledger.calculatePendingPayout(order.id);
          if (payout.gt(0)) {
            await this.ledger.recordDoubleEntry(tx, {
              orderId: order.id,
              debitAccount: "seller_payout",
              creditAccount: "payment_received",
              amount: payout,
              description: `Daily settlement ${date}`,
            });
          }
        }
      }
    });

    return {
      date,
      totalOrders: orders.length,
      totalRevenue: formatAmount(totalRevenue),
      totalFees: formatAmount(totalFees),
      totalPayout: formatAmount(totalPayout),
      idempotent: false,
    };
  }
}
