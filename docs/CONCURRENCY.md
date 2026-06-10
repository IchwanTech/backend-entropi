# Concurrency Strategy — Entropi Financial Backend

> Submission ID: **Ent-JFE-20/05/26**

## The Problem: 1,000+ Concurrent Requests

When 1,000 concurrent orders hit the API simultaneously, multiple threads may read the same Order row at the same `version`, then both attempt to update it. Without protection:

```
Thread A: SELECT order WHERE id='ord_1' → version=3
Thread B: SELECT order WHERE id='ord_1' → version=3

Thread A: UPDATE order SET version=4 WHERE id='ord_1' AND version=3 → OK ✅
Thread B: UPDATE order SET version=4 WHERE id='ord_1' AND version=3 → OK ✅ (CORRUPTION!)
```

Both writes succeed, creating two `PaymentConfirmed` events for the same order. This is unacceptable in a financial system.

---

## Defense Layer 1: Optimistic Locking

Every `Order` row has a `version: Int` field. All state-mutating operations include the expected version in the `WHERE` clause:

```typescript
// OrderService — every mutation follows this pattern
const updated = await tx.order.updateMany({
  where: {
    id: orderId,
    version: order.version,  // ← EXPECTED version from read
  },
  data: {
    status: newStatus,
    version: { increment: 1 }, // ← atomically bump
  },
});

if (updated.count === 0) {
  throw new VersionConflictError(orderId); // → HTTP 409
}
```

**What happens under concurrency:**

```
Thread A: SELECT → version=3
Thread B: SELECT → version=3

Thread A: UPDATE WHERE version=3 → count=1 ✅ (version now=4)
Thread B: UPDATE WHERE version=3 → count=0 ❌ → VersionConflictError (409)
```

**Why Optimistic, not Pessimistic (SELECT FOR UPDATE)?**

| | Optimistic | Pessimistic |
|-|-----------|-------------|
| How | Check at write time | Lock at read time |
| Throughput | High — no blocking | Low — serialized |
| Best for | Mostly-successful updates | High contention |
| Our case | 1,000 **different** orders | Each order has its own lock scope → optimistic wins |

For 1,000 concurrent requests to **different** orders, there is zero contention. For concurrent requests to the **same** order, exactly one wins and the others get a clean 409 to retry.

---

## Defense Layer 2: Idempotency Keys

Every mutating endpoint requires an `Idempotency-Key` request header. The key is stored in `EventLog.idempotencyKey` with a `UNIQUE` database constraint.

**Protocol:**

```typescript
// Inside Prisma $transaction:
const existingEvent = await tx.eventLog.findUnique({
  where: { idempotencyKey },
});

if (existingEvent) {
  // Already processed → return same result, no side effects
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

// First time → proceed with full mutation
```

**Why check inside the transaction, not before?**

```
Without transaction wrapping:
  Thread A: check key → not found
  Thread B: check key → not found    ← both see "not found"
  Thread A: insert EventLog → OK
  Thread B: insert EventLog → UNIQUE CONSTRAINT ERROR ← race condition

With transaction wrapping:
  Thread A's $transaction wins → commits key
  Thread B's $transaction reads the committed key → returns early
```

**Scenarios handled by idempotency:**

| Scenario | Without idempotency | With idempotency |
|----------|--------------------|--------------------|
| Client retries on timeout | Double charge | Return original result |
| Server crash after Stripe, before DB | Orphaned charge | Retry finds key, returns safe |
| Network duplicate | Two entries | One entry, one result |

---

## Defense Layer 3: Database Unique Constraints

Even if application-layer checks are bypassed (e.g., a bug, a race at the connection pool level), the database enforces:

```sql
-- EventLog: no two events with same aggregateId+version
UNIQUE (aggregateId, version)

-- EventLog: no two events with same idempotency key
UNIQUE (idempotencyKey)
```

This is **defense in depth** — the system remains correct even if layers 1 and 2 have edge cases.

---

## Defense Layer 4: Atomic Transactions

Every write operation wraps EventLog + Order + LedgerEntry in a single `Prisma.$transaction()`:

```typescript
await this.db.$transaction(async (tx) => {
  // 1. Idempotency check
  // 2. Read current order state
  // 3. Optimistic lock update
  // 4. Append event to EventLog
  // 5. Create 2 LedgerEntry rows (debit + credit)
}); // ← entire block commits or rolls back atomically
```

If step 5 fails, steps 3 and 4 are rolled back. The system never ends up with an `Order` in `PAYMENT_CONFIRMED` state without the corresponding `LedgerEntry` rows.

---

## Stress Test Expectations

When stress-tested with 1,000+ concurrent orders:

- **Different orders**: All 1,000 succeed. No contention.
- **Same order, concurrent**: Exactly 1 succeeds. Others return HTTP 409 (`VersionConflictError`).
- **Retried requests with same Idempotency-Key**: Return original response, no double-processing.
- **Ledger balance**: `GET /verify-ledger/:id` returns `{ balanced: true }` for every order.
