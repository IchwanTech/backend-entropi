import { FastifyInstance } from 'fastify'
import { SettlementService } from '../domain/settlement/settlement.service'
import { LedgerService } from '../domain/ledger/ledger.service'
import { EventStore } from '../domain/events/event-store'
import { ReadModelProjection } from '../projections/read-model'
import prisma from '../db/client'
import { z } from 'zod'

const settleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
})

export async function settlementRoute(fastify: FastifyInstance): Promise<void> {
  const eventStore = new EventStore(prisma)
  const ledger = new LedgerService(prisma)
  const settlementService = new SettlementService(prisma, eventStore, ledger)
  const readModel = new ReadModelProjection(prisma)

  // POST /settle — jalankan daily settlement
  fastify.post('/settle', async (request, reply) => {
    const body = settleSchema.parse(request.body)
    const result = await settlementService.settle(body.date)
    return reply.send({ data: result })
  })

  // GET /settle/:date — lihat hasil settlement
  fastify.get<{ Params: { date: string } }>('/settle/:date', async (request, reply) => {
    const summary = await readModel.getSettlementSummary(request.params.date)
    if (!summary) {
      return reply.status(404).send({
        error: 'SETTLEMENT_NOT_FOUND',
        message: `No settlement found for date ${request.params.date}`,
      })
    }
    return reply.send({ data: summary })
  })

  // GET /verify-ledger/:id — verifikasi balance ledger untuk satu order
  fastify.get<{ Params: { id: string } }>('/verify-ledger/:id', async (request, reply) => {
    const result = await ledger.verifyBalance(request.params.id)
    return reply.send({ data: result })
  })
}
