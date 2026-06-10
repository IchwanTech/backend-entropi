# Architecture — Entropi Financial Backend

> Submission ID: **Ent-JFE-20/05/26**

## System Overview

This system implements a financial event processing pipeline combining three battle-tested patterns:

1. **Event Sourcing** — all state changes are immutable, append-only events
2. **Double-Entry Ledger** — every transaction has a matching debit and credit
3. **CQRS** — write path (services) and read path (projections) are decoupled

---

## Full System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     HTTP Layer                               │
│                                                              │
│  POST /orders    POST /pay/:id    POST /ship/:id             │
│  GET /orders     GET /orders/:id  GET /settlement/:date      │
│  POST /settlement                 GET /verify-ledger/:id     │
└──────────────────────┬───────────────────────────────────────┘
                       │ JSON + Idempotency-Key header
                       │
┌──────────────────────▼───────────────────────────────────────┐
│               Fastify Middleware Pipeline                     │
│                                                              │
│  1. @fastify/helmet  → security headers                      │
│  2. @fastify/cors    → CORS (configurable via CORS_ORIGIN)   │
│  3. idempotencyPlugin → validate Idempotency-Key presence    │
│  4. Zod schemas      → validate all request body/params      │
│  5. errorHandler     → unified error-to-HTTP-status mapping  │
└──────────────────────┬───────────────────────────────────────┘
                       │
         ┌─────────────┼──────────────┐
         │             │              │
┌────────▼──────┐ ┌────▼─────┐ ┌────▼──────────┐
│ OrderService  │ │ PayRoute │ │ Settlement    │
│               │ │          │ │ Service       │
│ - recordOrder │ │ - pay()  │ │               │
│ - markShipped │ │ - ship() │ │ - settle()    │
│ - findById    │ │          │ │ - getResult() │
└───────┬───────┘ └────┬─────┘ └────┬──────────┘
        │              │             │
        └──────────────▼─────────────┘
                       │
         ┌─────────────▼──────────────────────┐
         │        Prisma $transaction()        │
         │  Atomic: EventLog + Order + Ledger  │
         └─────────────┬──────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                    PostgreSQL (Supabase)                      │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │     Order        │  │    EventLog       │                  │
│  │─────────────────│  │──────────────────│                  │
│  │ id (cuid)       │  │ id (cuid)         │                  │
│  │ customerId      │  │ aggregateId       │                  │
│  │ amount Dec(18,4)│  │ eventType (enum)  │                  │
│  │ status (enum)   │  │ payload (JSON)    │                  │
│  │ version (int)   │  │ version (int)     │                  │
│  │ createdAt       │  │ idempotencyKey    │                  │
│  │                 │  │   (UNIQUE)        │                  │
│  └─────────────────┘  └──────────────────┘                  │
│                                                              │
│  ┌──────────────────────────────────────┐                   │
│  │            LedgerEntry               │                   │
│  │──────────────────────────────────────│                   │
│  │ id (cuid)                            │                   │
│  │ orderId (FK → Order.id)              │                   │
│  │ account (enum: 5 account types)      │                   │
│  │ debit  Decimal(18,4) nullable        │                   │
│  │ credit Decimal(18,4) nullable        │                   │
│  │ description                          │                   │
│  │ timestamp                            │                   │
│  └──────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
```

---

## CQRS: Read vs Write Path

```
WRITE PATH                           READ PATH
──────────                           ─────────
POST /orders                         GET /orders
  └→ OrderService.recordOrder()        └→ ReadModelProjection.listOrders()
       └→ EventStore.append()               └→ db.order.findMany()
       └→ LedgerService.record()
       └→ db.order.create()          GET /orders/:id
                                       └→ ReadModelProjection.getOrderSummary()
POST /pay/:id                               └→ db.order.findUnique()
  └→ OrderService.recordPayment()           └→ db.eventLog.findFirst()
       └→ EventStore.append()
       └→ LedgerService.record()     GET /orders/:id/ledger
       └→ db.order.updateMany()        └→ LedgerService.getAuditTrail()
```

Write path mutates state atomically. Read path is optimized for querying without locks.

---

## Why Event Sourcing?

| Traditional CRUD | Event Sourcing |
|-----------------|----------------|
| Overwrites state — history lost | Appends events — full history |
| Can't replay what happened | Can rebuild state from events |
| Hard to debug past states | Every state change is auditable |
| Hard to add new projections | Can project any view from events |

---

## Why CQRS?

The `ReadModelProjection` (read path) can evolve independently from the domain services (write path). We can add new read views (e.g., analytics, reports) without touching the transactional core.

---

## Deployment Architecture (Vercel Serverless)

```
Internet
  │
  ▼
Vercel Edge Network
  │
  ▼
api/index.ts (Serverless Function)
  │  wraps Fastify instance
  │  caches app across invocations
  ▼
Fastify (in-memory, reused across warm starts)
  │
  ▼
Supabase PostgreSQL (external)
```

The Fastify instance is cached at the module level to avoid cold-start overhead on repeated requests.

---

## Key Design Decisions

| Decision | Alternative Considered | Reason Chosen |
|----------|----------------------|---------------|
| Optimistic locking | Pessimistic (SELECT FOR UPDATE) | No lock contention, scales better for high read:write ratio |
| App-level idempotency | DB upsert only | Catches duplicates before any side effects run |
| decimal.js | Native JS number | 0.1 + 0.2 = 0.30000000000000004 in JS — unacceptable for finance |
| Zod env validation | dotenv only | Catches missing vars at startup, not at runtime |
| Fastify | Express | ~2x faster, built-in schema serialization |
