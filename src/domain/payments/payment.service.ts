import { PrismaClient } from '@prisma/client'
import { StripeMock } from './stripe.mock'
import { OrderService } from '../orders/order.service'
import { toDecimal } from '../../lib/decimal'
import { OrderNotFoundError } from '../../lib/errors'

export class PaymentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly stripe: StripeMock,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Full payment flow:
   *   1. Validasi order ada dan dalam status PENDING
   *   2. Update status → PAYMENT_PROCESSING
   *   3. Charge via Stripe (mock)
   *   4. Jika sukses → recordPayment (event + ledger)
   *   5. calculateFees (event + ledger)
   *
   * IDEMPOTENT: idempotencyKey dipakai di setiap step.
   * Stripe charge juga idempotent via stripeIdempotencyKey.
   */
  async processPayment(params: {
    orderId: string
    customerId: string
    idempotencyKey: string
  }): Promise<PaymentResult> {
    const { orderId, customerId, idempotencyKey } = params

    // Ambil order
    const order = await this.orderService.findById(orderId)
    const amount = toDecimal(order.amount.toString())

    // Step 1: Update ke PAYMENT_PROCESSING
    // Pakai idempotencyKey + '-processing' supaya tidak collision dengan step selanjutnya
    await this.db.$transaction(async (tx: any) => {
      const existingProcessing = await tx.eventLog.findUnique({
        where: { idempotencyKey: `${idempotencyKey}-processing` },
      })
      if (existingProcessing) return // already processing, skip

      const current = await tx.order.findUnique({ where: { id: orderId } })
      if (!current) throw new OrderNotFoundError(orderId)

      // Kalau sudah PAYMENT_CONFIRMED, skip seluruh flow (idempotent)
      if (current.status === 'PAYMENT_CONFIRMED' || current.status === 'FEE_CALCULATED') {
        return
      }

      if (current.status !== 'PENDING') return // state invalid, biarkan caller handle

      await tx.order.updateMany({
        where: { id: orderId, version: current.version },
        data: { status: 'PAYMENT_PROCESSING', version: { increment: 1 } },
      })

      await tx.eventLog.create({
        data: {
          aggregateId: orderId,
          eventType: 'PaymentProcessing',
          payload: { type: 'PaymentProcessing', stripeIdempotencyKey: `${idempotencyKey}-stripe` },
          version: current.version + 1,
          idempotencyKey: `${idempotencyKey}-processing`,
        },
      })
    })

    // Step 2: Charge Stripe
    // Stripe idempotency key terpisah supaya bisa retry kalau server crash setelah charge tapi sebelum DB update
    const stripeResult = await this.stripe.charge({
      orderId,
      amount,
      customerId,
      idempotencyKey: `${idempotencyKey}-stripe`,
    })

    // Step 3: Catat payment di DB
    await this.orderService.recordPayment({
      orderId,
      amount: amount.toFixed(4),
      chargeId: stripeResult.chargeId,
      idempotencyKey: `${idempotencyKey}-confirmed`,
    })

    // Step 4: Kalkulasi fee
    await this.orderService.calculateFees({
      orderId,
      amount: amount.toFixed(4),
      idempotencyKey: `${idempotencyKey}-fee`,
    })

    return {
      orderId,
      chargeId: stripeResult.chargeId,
      amount: amount.toFixed(4),
      status: 'succeeded',
    }
  }
}

export interface PaymentResult {
  orderId: string
  chargeId: string
  amount: string
  status: 'succeeded'
}
