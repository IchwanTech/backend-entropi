# Entropi Backend — Financial Event Store & Double-Entry Ledger

> JUNIOR FULLSTACK ENGINEER — Ent-JFE-20/05/26

A production-grade financial processing backend built with **Fastify + TypeScript**, implementing **Event Sourcing** and **Double-Entry Accounting** principles on top of **PostgreSQL**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   HTTP Clients / Frontend               │
└──────────────────────────┬──────────────────────────────┘
                           │ REST + Idempotency-Key header
┌──────────────────────────▼──────────────────────────────┐
│                  Fastify API Server                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ /orders     │  │  /payments   │  │  /settlement   │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         └────────────────┼──────────────────┘           │
│                          │                              │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │              Domain Services                     │   │
│  │  OrderService │ SettlementService │ LedgerService│   │
│  └───────────────────────┬──────────────────────────┘   │
│                          │  Prisma $transaction()       │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │             PostgreSQL (Supabase)                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │   │
│  │  │  Order   │  │ EventLog │  │  LedgerEntry  │   │   │
│  │  │ (state)  │  │(history) │  │   (finance)   │   │   │
│  │  └──────────┘  └──────────┘  └───────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Framework | Fastify 4 | High-throughput, schema-first, typed |
| Language | TypeScript (strict) | Type safety for financial domain |
| ORM | Prisma 5 | Type-safe DB queries, migrations |
| Database | PostgreSQL (Supabase) | ACID, strong consistency |
| Decimal | decimal.js | Exact arithmetic — no float rounding errors |
| Validation | Zod | Runtime schema validation on all inputs |
| Tests | Jest + supertest | Integration + unit coverage |
| Hosting | Vercel (Serverless) | Zero-config, free-tier compatible |

---

## Ledger Design

Every financial mutation creates **exactly 2 LedgerEntry rows** (debit + credit). This enforces the double-entry accounting invariant: `Σ(debit) = Σ(credit)` for every order.

```
OrderCreated:
  DEBIT  order_balance   +amount   ← order obligation created
  CREDIT order_pending   +amount   ← awaiting payment confirmation

PaymentConfirmed:
  DEBIT  payment_received  +amount  ← cash received
  CREDIT order_balance     -amount  ← obligation settled

FeeCalculated (3%):
  DEBIT  fees_owed         +fee     ← platform takes its cut
  CREDIT payment_received  -fee     ← reduces available balance

SettlementProcessed:
  DEBIT  seller_payout     +net     ← disbursed to seller
  CREDIT payment_received  -net     ← reduces platform balance
```

**Verification endpoint**: `GET /verify-ledger/:orderId`  
Returns `{ balanced: true }` or throws `LedgerImbalanceError` if `Σdebit ≠ Σcredit`.

---

## Concurrency Strategy

Designed to survive **1,000+ concurrent requests** to the same order without data corruption.

### Layer 1 — Optimistic Locking
```sql
UPDATE orders
SET status = ?, version = version + 1
WHERE id = ? AND version = ?   -- fails if version changed
-- affected rows = 0 → throw VersionConflictError
```

### Layer 2 — Idempotency Keys
Every mutation requires an `Idempotency-Key` header. The key is stored in `EventLog.idempotencyKey` with a `UNIQUE` constraint. Duplicate requests return the original response — no double-processing.

### Layer 3 — DB Unique Constraints (Defense in Depth)
- `UNIQUE(aggregateId, version)` on EventLog → prevents duplicate events at DB level
- `UNIQUE(idempotencyKey)` on EventLog → prevents race conditions even if app-layer check is bypassed

All three layers operate within a single `Prisma.$transaction()`, ensuring atomicity.

---

## Project Structure

```
src/
├── config/env.ts            # Zod-validated env schema
├── db/                      # Prisma client singleton + types
├── domain/
│   ├── events/              # EventStore — append-only event log
│   ├── ledger/              # Double-entry ledger service
│   ├── orders/              # OrderService — state machine
│   └── settlement/          # SettlementService — daily payout
├── lib/                     # decimal.js helpers, error classes
├── middleware/              # Idempotency plugin, error handler
├── projections/             # ReadModelProjection (CQRS read side)
├── routes/                  # Fastify route handlers
└── server.ts                # Server factory
api/
└── index.ts                 # Vercel Serverless Function adapter
docs/
├── ARCHITECTURE.md
├── CONCURRENCY.md
└── FINANCIAL_RULES.md
prisma/
├── schema.prisma
├── migrations/
└── seed.ts                  # Realistic 7-day historical data
tests/
└── integration/orders.test.ts
```

---

## Order State Machine

```
PENDING
  └─→ PAYMENT_PROCESSING
        └─→ PAYMENT_CONFIRMED
              └─→ FEE_CALCULATED
                    └─→ SHIPPED
                          └─→ DELIVERED
        └─→ FAILED
  └─→ REFUNDED
```

Invalid transitions are rejected with `InvalidTransitionError` (HTTP 422).

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Push schema + seed realistic data
npx prisma migrate dev
npm run db:seed

# 4. Start dev server
npm run dev
# → http://localhost:3001
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Supabase pooler connection string |
| `DIRECT_URL` | ✅ | Supabase direct connection (for migrations) |
| `CORS_ORIGIN` | ✅ | Allowed frontend origins (comma-separated, or `*`) |
| `PORT` | ❌ | Server port (default: 3001) |
| `STRIPE_MOCK_FAILURE_RATE` | ❌ | Simulated payment failure rate (default: 0.05) |

---

## Running Tests

```bash
# Run integration tests (requires .env with real DB)
npm test

# With coverage
npm run test:coverage
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/orders` | Create a new order |
| `GET` | `/orders` | List orders (paginated, filterable by status) |
| `GET` | `/orders/:id` | Get order summary with ledger state |
| `GET` | `/orders/:id/events` | Get full event history for an order |
| `GET` | `/orders/:id/ledger` | Get double-entry audit trail |
| `GET` | `/verify-ledger/:id` | Verify ledger balance for an order |
| `POST` | `/pay/:id` | Process payment (with mock Stripe) |
| `POST` | `/ship/:id` | Mark order as shipped |
| `POST` | `/settlement` | Run daily settlement for a date |
| `GET` | `/settlement/:date` | Get settlement result for a date |
| `GET` | `/test` | Health check |

---

## Deployment

- **Backend**: Vercel (Serverless — via `api/index.ts` + `vercel.json`)
- **Frontend**: Vercel (Next.js)
- **Database**: Supabase (PostgreSQL)

All writes are atomic. All financial operations use `Decimal(18,4)` precision. All mutations are idempotent.

---

*Built with precision for Entropi Financial Engineering Assessment — Ent-JFE-20/05/26*
