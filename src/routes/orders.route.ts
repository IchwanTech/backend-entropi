import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OrderService } from '../domain/orders/order.service'
import { ReadModelProjection } from '../projections/read-model'
import { LedgerService } from '../domain/ledger/ledger.service'
import { EventStore } from '../domain/events/event-store'
import prisma from '../db/client'

// Zod schemas untuk request validation
const createOrderSchema = z.object({
  orderId: z.string().min(1).max(128),
  customerId: z.string().min(1),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a valid decimal string'),
  paymentMethod: z.enum(['credit_card', 'debit_card', 'bank_transfer']),
})

const shipOrderSchema = z.object({
  trackingNumber: z.string().min(1),
})

export async function ordersRoute(fastify: FastifyInstance): Promise<void> {
  const eventStore = new EventStore(prisma)
  const ledger = new LedgerService(prisma)
  const orderService = new OrderService(prisma, eventStore, ledger)
  const readModel = new ReadModelProjection(prisma)

  // POST /orders — buat order baru
  fastify.post('/orders', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'] as string
    const body = createOrderSchema.parse(request.body)

    const order = await orderService.recordOrder({
      ...body,
      idempotencyKey,
    })

    return reply.status(201).send({
      data: await readModel.getOrderSummary(order.id),
    })
  })

  // GET /orders — list semua order
  fastify.get('/orders', async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
        status: z.string().optional(),
      })
      .parse(request.query)

    const result = await readModel.listOrders({ page: query.page, limit: query.limit, ...(query.status !== undefined && { status: query.status }) })
    return reply.send({ data: result })
  })

  // GET /orders/:id — detail satu order
  fastify.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const summary = await readModel.getOrderSummary(request.params.id)
    if (!summary) {
      return reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' })
    }
    return reply.send({ data: summary })
  })

  // GET /orders/:id/ledger — audit trail
  fastify.get<{ Params: { id: string } }>('/orders/:id/ledger', async (request, reply) => {
    const trail = await ledger.getAuditTrail(request.params.id)
    return reply.send({ data: trail })
  })

  // GET /orders/:id/events — event log untuk satu order
  fastify.get<{ Params: { id: string } }>('/orders/:id/events', async (request, reply) => {
    const events = await eventStore.getEvents(request.params.id)
    return reply.send({ data: events })
  })

  // POST /orders/:id/ship — mark shipped
  fastify.post<{ Params: { id: string } }>('/orders/:id/ship', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'] as string
    const body = shipOrderSchema.parse(request.body)

    const order = await orderService.markShipped({
      orderId: request.params.id,
      trackingNumber: body.trackingNumber,
      idempotencyKey,
    })

    return reply.send({ data: await readModel.getOrderSummary(order.id) })
  })
}
