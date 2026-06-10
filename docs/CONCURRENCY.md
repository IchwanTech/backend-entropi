# Concurrency Strategy

## The Problem

1.000 concurrent orders = race conditions kalau tidak ditangani dengan benar.

Masalah klasik:
- Dua request baca `version=1`, keduanya coba update ke `version=2`
- Tanpa proteksi: keduanya sukses → data corrupt
- Dengan proteksi: hanya satu yang menang, yang lain retry

## Solution: Optimistic Locking

Setiap Order punya field `version: Int`.

**Write flow:**
```sql
UPDATE orders
SET status = 'PAYMENT_CONFIRMED', version = version + 1
WHERE id = $orderId AND version = $expectedVersion
```

Kalau `count = 0` → version sudah berubah (ada yang lebih cepat) → throw `VersionConflictError`.

**Kenapa optimistic, bukan pessimistic?**
- Pessimistic (SELECT FOR UPDATE) = row lock, memblok semua request lain
- Optimistic = tidak ada lock, hanya verifikasi di saat write
- Untuk workload read-heavy (1.000 orders berbeda), optimistic jauh lebih scalable

## Safety Net: DB Unique Constraints

Bahkan kalau optimistic lock tidak cukup, DB punya:
- `UNIQUE(aggregateId, version)` di EventLog → dua events dengan version sama tidak bisa exist
- `UNIQUE(idempotencyKey)` → request yang sama tidak bisa tercatat dua kali

Ini adalah **defense in depth**: aplikasi layer + DB layer.

## Idempotency

Setiap mutation memerlukan `Idempotency-Key` header.

Flow:
```
1. Cek apakah idempotencyKey sudah ada di EventLog
2. Kalau ada → return existing result (no-op)
3. Kalau tidak ada → proses normally
4. Semua dalam satu transaction → atomic
```

**Kenapa cek di awal transaction, bukan sebelumnya?**

Kalau cek di luar transaction:
```
Thread A: cek key → tidak ada
Thread B: cek key → tidak ada
Thread A: insert key → sukses
Thread B: insert key → DUPLICATE KEY ERROR ← race condition!
```

Dengan cek di dalam transaction + unique constraint: DB menjamin atomicity.

## Stripe Idempotency

Stripe charge juga idempotent via `stripe_idempotency_key`.
Ini penting untuk skenario: server crash setelah charge tapi sebelum DB update.
Kalau retry, Stripe return result yang sama (tidak charge ulang).
