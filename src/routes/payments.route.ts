import { FastifyInstance } from 'fastify'
import { PaymentService } from '../domain/payments/payment.service'
import { OrderService } from '../domain/orders/order.service'
import { LedgerService } from '../domain/ledger/ledger.service'
import { EventStore } from '../domain/events/event-store'
import { StripeMock } from '../domain/payments/stripe.mock'
import { ReadModelProjection } from '../projections/read-model'
import prisma from '../db/client'
import { z } from 'zod'

const paySchema = z.object({
  customerId: z.string().min(1),
})

export async function paymentsRoute(fastify: FastifyInstance): Promise<void> {
  const eventStore = new EventStore(prisma)
  const ledger = new LedgerService(prisma)
  const orderService = new OrderService(prisma, eventStore, ledger)
  const stripe = new StripeMock()
  const paymentService = new PaymentService(prisma, stripe, orderService)
  const readModel = new ReadModelProjection(prisma)

  // POST /orders/:id/pay
  fastify.post<{ Params: { id: string } }>('/orders/:id/pay', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'] as string
    const body = paySchema.parse(request.body)

    const result = await paymentService.processPayment({
      orderId: request.params.id,
      customerId: body.customerId,
      idempotencyKey,
    })

    const summary = await readModel.getOrderSummary(request.params.id)

    return reply.send({ data: { payment: result, order: summary } })
  })
}
