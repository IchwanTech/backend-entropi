# Architecture

## Overview

System ini mengimplementasikan financial processing pipeline dengan:
- **Event Sourcing**: semua state changes dicatat sebagai immutable events
- **Double-Entry Ledger**: setiap transaksi punya sisi debit dan kredit
- **CQRS**: write path (services) terpisah dari read path (projections)

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify + TypeScript strict |
| ORM | Prisma |
| Database | PostgreSQL (Supabase) |
| Decimal | decimal.js (bukan native float) |
| Validation | Zod |
| Tests | Jest + ts-jest |

## Domain Model

```
Order (aggregate root)
  ├── EventLog[] (append-only event stream)
  └── LedgerEntry[] (double-entry accounting)
```

## Write Flow

```
HTTP Request
  → Zod validation
  → Idempotency check (EventLog.idempotencyKey)
  → Optimistic lock (Order.version)
  → Prisma.$transaction {
      EventLog.create()
      LedgerEntry.create() × 2  ← debit + credit
      Order.updateMany()
    }
  → Response
```

## Why Event Sourcing?

1. **Immutability**: events tidak pernah di-update/delete → audit trail sempurna
2. **Replay**: kalau ada bug, bisa rebuild state dari scratch dengan replay events
3. **Debuggability**: tahu persis apa yang terjadi dan kapan

## Why Double-Entry Ledger?

1. **Always balanced**: `sum(debit) = sum(credit)` adalah invariant yang selalu bisa diverifikasi
2. **Financial accuracy**: tidak ada uang yang "hilang" — setiap rupiah tertrack
3. **Compliance**: standar akuntansi yang diakui secara hukum

## Why Decimal(18,4)?

- Native JS `number` adalah float64 → `0.1 + 0.2 ≠ 0.3`
- `Decimal(18,4)`: 18 digit total precision, 4 digit setelah koma
- Cukup untuk amount sampai `$99,999,999,999,999.9999`
- `decimal.js` library memastikan semua operasi aritmatika exact

## Concurrency Strategy

Lihat [CONCURRENCY.md](./CONCURRENCY.md)

## Financial Rules

Lihat [FINANCIAL_RULES.md](./FINANCIAL_RULES.md)
