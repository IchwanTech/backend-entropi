import { Decimal } from '../../lib/decimal'
import { CardDeclinedError, StripeError } from '../../lib/errors'
import { env } from '../../config/env'

export interface StripeChargeResult {
  chargeId: string
  status: 'succeeded' | 'pending' | 'failed'
  amount: string
  customerId: string
}

export interface StripeRefundResult {
  refundId: string
  chargeId: string
  amount: string
  status: 'succeeded'
}

/**
 * Mock Stripe client.
 *
 * Idempotency: Stripe menggunakan idempotency key untuk prevent double-charge.
 * Kita simulate dengan in-memory map (production: Stripe handles this natively).
 *
 * Error simulation: random failure sesuai STRIPE_MOCK_FAILURE_RATE env var.
 */
export class StripeMock {
  // In-memory store untuk idempotency (simulate Stripe's idempotency key behavior)
  private readonly processedCharges = new Map<string, StripeChargeResult>()
  private readonly processedRefunds = new Map<string, StripeRefundResult>()

  /**
   * Process payment. IDEMPOTENT — panggil 2x dengan key yang sama = return result pertama.
   */
  async charge(params: {
    orderId: string
    amount: Decimal
    customerId: string
    idempotencyKey: string
  }): Promise<StripeChargeResult> {
    const { orderId, amount, customerId, idempotencyKey } = params

    // Idempotency: return existing result kalau sudah pernah diproses
    const existing = this.processedCharges.get(idempotencyKey)
    if (existing) return existing

    // Simulate network latency
    await this.simulateLatency()

    // Simulate random card decline
    if (this.shouldFail()) {
      throw new CardDeclinedError()
    }

    // Simulate rare Stripe error
    if (this.shouldStripeError()) {
      throw new StripeError('Stripe service temporarily unavailable')
    }

    const result: StripeChargeResult = {
      chargeId: `ch_mock_${generateId()}`,
      status: 'succeeded',
      amount: amount.toFixed(4),
      customerId,
    }

    this.processedCharges.set(idempotencyKey, result)
    return result
  }

  /**
   * Process refund. IDEMPOTENT.
   */
  async refund(params: {
    chargeId: string
    amount: Decimal
    idempotencyKey: string
  }): Promise<StripeRefundResult> {
    const { chargeId, amount, idempotencyKey } = params

    const existing = this.processedRefunds.get(idempotencyKey)
    if (existing) return existing

    await this.simulateLatency()

    const result: StripeRefundResult = {
      refundId: `re_mock_${generateId()}`,
      chargeId,
      amount: amount.toFixed(4),
      status: 'succeeded',
    }

    this.processedRefunds.set(idempotencyKey, result)
    return result
  }

  private shouldFail(): boolean {
    return Math.random() < env.STRIPE_MOCK_FAILURE_RATE
  }

  private shouldStripeError(): boolean {
    return Math.random() < 0.01 // 1% chance Stripe error
  }

  private async simulateLatency(): Promise<void> {
    const ms = 50 + Math.random() * 100 // 50–150ms
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

// Singleton instance
export const stripe = new StripeMock()
