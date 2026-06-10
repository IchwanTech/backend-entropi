export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

// Thrown ketika dua concurrent request coba update dengan version yang sama
export class VersionConflictError extends AppError {
  constructor(orderId: string) {
    super(
      `Version conflict on order ${orderId}. Another request updated this order concurrently.`,
      'VERSION_CONFLICT',
      409,
    )
  }
}

// Thrown ketika order tidak ditemukan
export class OrderNotFoundError extends AppError {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`, 'ORDER_NOT_FOUND', 404)
  }
}

// Thrown ketika state machine transition tidak valid
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(
      `Invalid order transition: ${from} → ${to}`,
      'INVALID_TRANSITION',
      422,
    )
  }
}

// Thrown ketika ledger tidak balance (sum debit ≠ sum credit)
export class LedgerImbalanceError extends AppError {
  constructor(orderId: string, diff: string) {
    super(
      `Ledger imbalance on order ${orderId}: difference = ${diff}`,
      'LEDGER_IMBALANCE',
      500,
    )
  }
}

// Stripe errors
export class StripeError extends AppError {
  constructor(message: string) {
    super(message, 'STRIPE_ERROR', 502)
  }
}

export class CardDeclinedError extends AppError {
  constructor() {
    super('Card was declined', 'CARD_DECLINED', 402)
  }
}
