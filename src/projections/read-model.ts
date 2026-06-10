import { Order } from "../db/types";
import {
  toDecimal,
  formatAmount,
  calculateFee,
  calculatePayout,
} from "../lib/decimal";

export class ReadModelProjection {
  constructor(private readonly db: any) {}

  async getOrderSummary(orderId: string): Promise<OrderSummary | null> {
    const order: Order | null = await this.db.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return null;

    // EventLog FK to Order was intentionally removed (to allow settlement events).
    // Query events separately via aggregateId.
    const latestEvent = await this.db.eventLog.findFirst({
      where: { aggregateId: orderId },
      orderBy: { version: "desc" },
      select: { eventType: true, timestamp: true },
    });

    const amount = toDecimal(order.amount.toString());
    const fee = calculateFee(amount);
    const payout = calculatePayout(amount);

    return {
      id: order.id,
      customerId: order.customerId,
      amount: formatAmount(amount),
      fee: formatAmount(fee),
      payout: formatAmount(payout),
      paymentMethod: order.paymentMethod,
      status: order.status,
      version: order.version,
      lastEventType: latestEvent?.eventType ?? null,
      lastEventAt: latestEvent?.timestamp?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  async listOrders(params: {
    page: number;
    limit: number;
    status?: string;
  }): Promise<{ orders: OrderSummary[]; total: number }> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [orders, total] = await Promise.all([
      this.db.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.db.order.count({ where }),
    ]);

    const summaries = (orders as Order[]).map((order) => {
      const amount = toDecimal(order.amount.toString());
      return {
        id: order.id,
        customerId: order.customerId,
        amount: formatAmount(amount),
        fee: formatAmount(calculateFee(amount)),
        payout: formatAmount(calculatePayout(amount)),
        paymentMethod: order.paymentMethod,
        status: order.status,
        version: order.version,
        lastEventType: null,
        lastEventAt: null,
        createdAt: order.createdAt.toISOString(),
      };
    });

    return { orders: summaries, total };
  }

  async getSettlementSummary(date: string): Promise<SettlementSummary | null> {
    const event = await this.db.eventLog.findUnique({
      where: { idempotencyKey: `settlement-${date}` },
    });
    if (!event) return null;
    const payload = event.payload as Record<string, string>;
    return {
      date,
      totalOrders: parseInt(payload["totalOrders"] ?? "0"),
      totalRevenue: payload["totalRevenue"] ?? "0.0000",
      totalFees: payload["totalFees"] ?? "0.0000",
      totalPayout: payload["totalPayout"] ?? "0.0000",
      settledAt: event.timestamp.toISOString(),
    };
  }
}

export interface OrderSummary {
  id: string;
  customerId: string;
  amount: string;
  fee: string;
  payout: string;
  paymentMethod: string;
  status: string;
  version: number;
  lastEventType: string | null;
  lastEventAt: string | null;
  createdAt: string;
}

export interface SettlementSummary {
  date: string;
  totalOrders: number;
  totalRevenue: string;
  totalFees: string;
  totalPayout: string;
  settledAt: string;
}
