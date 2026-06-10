import { OrderStatus, EventType } from '../../db/types'

export { EventType, OrderStatus }

export type EventPayload =
  | { type: 'OrderCreated'; amount: string; customerId: string; paymentMethod: string }
  | { type: 'PaymentProcessing'; stripeIdempotencyKey: string }
  | { type: 'PaymentConfirmed'; chargeId: string; amount: string }
  | { type: 'FeeCalculated'; fee: string; rate: string }
  | { type: 'OrderShipped'; trackingNumber: string }
  | { type: 'OrderDelivered' }
  | { type: 'RefundInitiated'; reason: string }
  | { type: 'RefundCompleted'; refundId: string; amount: string }
  | { type: 'SettlementProcessed'; date: string; totalAmount: string }

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING:              ['PAYMENT_PROCESSING', 'FAILED'],
  PAYMENT_PROCESSING:   ['PAYMENT_CONFIRMED', 'FAILED'],
  PAYMENT_CONFIRMED:    ['FEE_CALCULATED', 'REFUNDED'],
  FEE_CALCULATED:       ['SHIPPED', 'REFUNDED'],
  SHIPPED:              ['DELIVERED', 'REFUNDED'],
  DELIVERED:            ['REFUNDED'],
  REFUNDED:             [],
  FAILED:               [],
}

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}
