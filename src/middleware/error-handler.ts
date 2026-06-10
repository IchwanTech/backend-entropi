import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../lib/errors'
import { ZodError } from 'zod'

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Domain errors (AppError dan subclass-nya)
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
    })
    return
  }

  // Zod validation errors
  if (error instanceof ZodError) {
    reply.status(422).send({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.flatten().fieldErrors,
    })
    return
  }

  // Fastify built-in validation errors (schema validation)
  if ('validation' in error && error.validation) {
    reply.status(400).send({
      error: 'BAD_REQUEST',
      message: error.message,
    })
    return
  }

  // Unknown errors
  request.log.error(error)
  reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  })
}
