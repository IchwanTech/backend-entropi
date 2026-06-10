import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Middleware: validasi bahwa semua mutation request punya Idempotency-Key header.
 * Header ini wajib untuk semua POST/PATCH/PUT requests ke /orders dan /settle.
 */
const idempotencyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const mutationMethods = ['POST', 'PUT', 'PATCH']
    const protectedPaths = ['/orders', '/settle']

    const isMutation = mutationMethods.includes(request.method)
    const isProtected = protectedPaths.some((path) => request.url.startsWith(path))

    if (isMutation && isProtected) {
      const idempotencyKey = request.headers['idempotency-key']

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        return reply.status(400).send({
          error: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header is required for all mutations',
        })
      }

      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return reply.status(400).send({
          error: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key must be between 8 and 128 characters',
        })
      }
    }
  })
}

export default fp(idempotencyPlugin, { name: 'idempotency' })
