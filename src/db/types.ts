export type OrderStatus =
  | "PENDING"
  | "PAYMENT_PROCESSING"
  | "PAYMENT_CONFIRMED"
  | "FEE_CALCULATED"
  | "SHIPPED"
  | "DELIVERED"
  | "REFUNDED"
  | "FAILED";

export type EventType =
  | "OrderCreated"
  | "PaymentProcessing"
  | "PaymentConfirmed"
  | "FeeCalculated"
  | "OrderShipped"
  | "OrderDelivered"
  | "RefundInitiated"
  | "RefundCompleted"
  | "SettlementProcessed";

export type AccountType =
  | "order_balance"
  | "order_pending"
  | "payment_received"
  | "fees_owed"
  | "seller_payout";

export interface Order {
  id: string;
  customerId: string;
  amount: { toString(): string };
  paymentMethod: string;
  status: OrderStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventLog {
  id: string;
  aggregateId: string;
  eventType: EventType;
  payload: unknown;
  version: number;
  timestamp: Date;
  idempotencyKey: string;
}

export interface LedgerEntry {
  id: string;
  orderId: string;
  account: AccountType;
  debit: { toString(): string } | null;
  credit: { toString(): string } | null;
  description: string | null;
  timestamp: Date;
}

export interface TransactionClient {
  order: {
    create(args: any): Promise<Order>;
    findUnique(args: any): Promise<Order | null>;
    findUniqueOrThrow(args: any): Promise<Order>;
    findMany(args?: any): Promise<Order[]>;
    updateMany(args: any): Promise<{ count: number }>;
    count(args?: any): Promise<number>;
  };
  eventLog: {
    create(args: any): Promise<EventLog>;
    findUnique(args: any): Promise<EventLog | null>;
    findFirst(args?: any): Promise<EventLog | null>;
    findMany(args?: any): Promise<EventLog[]>;
  };
  ledgerEntry: {
    create(args: any): Promise<LedgerEntry>;
    findMany(args?: any): Promise<LedgerEntry[]>;
  };
}

export class PrismaKnownError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
