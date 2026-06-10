# Financial Rules — Entropi Financial Backend

> Submission ID: **Ent-JFE-20/05/26**

## Core Invariant: Double-Entry Accounting

Every financial event creates **exactly two LedgerEntry rows**:
- One **DEBIT** (value flowing into an account)
- One **CREDIT** (value flowing out of an account)

The invariant that must always hold:

```
Σ(debit entries for orderId) = Σ(credit entries for orderId)
```

This is verified by `GET /verify-ledger/:id`. If ever broken, `LedgerImbalanceError` is thrown.

---

## Account Chart

| Account | Type | Description |
|---------|------|-------------|
| `order_balance` | Liability | The order amount owed by the customer |
| `order_pending` | Liability | Amount awaiting payment confirmation |
| `payment_received` | Asset | Cash received and available |
| `fees_owed` | Expense | Platform fee (3%) charged against revenue |
| `seller_payout` | Expense | Net amount disbursed to seller |

---

## Ledger Entries Per Business Event

### 1. `OrderCreated`

When a new order is placed, the obligation is recorded:

```
DEBIT  order_balance   +amount    ← "we are owed this amount"
CREDIT order_pending   +amount    ← "pending payment confirmation"
```

Running balance: order is registered but no money has moved yet.

---

### 2. `PaymentConfirmed`

When Stripe confirms the charge:

```
DEBIT  payment_received  +amount   ← "cash received"
CREDIT order_balance     -amount   ← "obligation fulfilled"
```

Running balance: money is in the platform, order obligation cleared.

---

### 3. `FeeCalculated` (3% platform fee)

Immediately after payment, the platform fee is carved out:

```
DEBIT  fees_owed         +fee      ← "platform claims its 3%"
CREDIT payment_received  -fee      ← "reduces available seller balance"
```

Fee formula:
```
fee = amount × 0.03  (rounded to 4 decimal places, ROUND_HALF_UP)
```

Running balance: `payment_received - fees_owed` = the net amount owed to the seller.

---

### 4. `SettlementProcessed` (Daily Settlement)

When the daily settlement job runs, net payout is disbursed:

```
DEBIT  seller_payout     +net      ← "transferred to seller account"
CREDIT payment_received  -net      ← "reduces platform's liability"
```

Net payout formula:
```
net = amount - fee = amount × 0.97
```

---

## Full Lifecycle — Ledger State for One Order

Given: `amount = 100.0000`

```
Event               | account           | DEBIT    | CREDIT   | Running (payment_received)
--------------------|-------------------|----------|----------|---------------------------
OrderCreated        | order_balance     | 100.0000 |          |
                    | order_pending     |          | 100.0000 |
--------------------|-------------------|----------|----------|---------------------------
PaymentConfirmed    | payment_received  | 100.0000 |          | +100.0000
                    | order_balance     |          | 100.0000 |
--------------------|-------------------|----------|----------|---------------------------
FeeCalculated       | fees_owed         |   3.0000 |          |
                    | payment_received  |          |   3.0000 | +97.0000
--------------------|-------------------|----------|----------|---------------------------
SettlementProcessed | seller_payout     |  97.0000 |          |
                    | payment_received  |          |  97.0000 | 0.0000 ← balanced ✅
```

After settlement: `Σ(debit) = 200.0000`, `Σ(credit) = 200.0000`.

---

## Decimal Precision Rules

### Why Not Native JavaScript `number`?

```javascript
0.1 + 0.2 === 0.3  // false → 0.30000000000000004
100 * 0.03 === 3   // false → 2.9999999999999996
```

JavaScript uses IEEE 754 double-precision floating point. Unacceptable for financial math.

### What We Use

```typescript
import Decimal from 'decimal.js';

// All calculations use decimal.js
const fee = amount.mul('0.03').toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
const payout = amount.sub(fee);
```

### Precision Rules

| Rule | Detail |
|------|--------|
| DB storage | `Decimal(18, 4)` — 18 total digits, 4 decimal places |
| Max safe value | `$99,999,999,999,999.9999` |
| Rounding | `ROUND_HALF_UP` (standard accounting) |
| API transport | Strings, never JSON numbers |
| Internal calculation | `decimal.js` instances only |

---

## Settlement Idempotency

Settlement is idempotent by design. The settlement event uses the key `settlement-{date}`. If the same date is settled twice:

```
POST /settlement  { date: "2026-06-10", idempotencyKey: "..." }
  → EventLog.findUnique({ where: { idempotencyKey: "settlement-2026-06-10" } })
  → Found → return stored result, no new LedgerEntries created
```

This prevents double-disbursement if the cron job retries or the request is called twice.

---

## Balance Verification

`GET /verify-ledger/:orderId` performs:

```typescript
const entries = await db.ledgerEntry.findMany({ where: { orderId } });

let totalDebit  = new Decimal(0);
let totalCredit = new Decimal(0);

for (const entry of entries) {
  if (entry.debit)  totalDebit  = totalDebit.add(entry.debit);
  if (entry.credit) totalCredit = totalCredit.add(entry.credit);
}

const diff = totalDebit.sub(totalCredit);
if (!diff.isZero()) throw new LedgerImbalanceError(orderId, diff);

return { balanced: true, difference: '0.0000' };
```

In a correctly functioning system, this **always returns `{ balanced: true }`** because:
1. Every event creates exactly one debit and one credit of equal value.
2. All writes are atomic (`$transaction`).
3. Fee and payout amounts are derived from the same source number, preventing drift.
