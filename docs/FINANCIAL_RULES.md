# Financial Rules

## Double-Entry Ledger

Setiap transaksi finansial menciptakan TEPAT DUA entri ledger:
- Satu **DEBIT** (nilai masuk ke account)
- Satu **CREDIT** (nilai keluar dari account)

**Invariant**: `sum(all debits) = sum(all credits)` untuk setiap orderId

## Account Types

| Account | Deskripsi |
|---------|-----------|
| `order_balance` | Total amount yang harus dibayar untuk order |
| `order_pending` | Amount dalam status pending konfirmasi |
| `payment_received` | Uang yang sudah diterima dari pembeli |
| `fees_owed` | Fee platform (3%) yang terutang |
| `seller_payout` | Jumlah yang dibayarkan ke seller |

## Ledger Entries Per Event

### OrderCreated
```
DEBIT  order_balance   +amount   (hutang order)
CREDIT order_pending   +amount   (menunggu konfirmasi)
```

### PaymentConfirmed
```
DEBIT  payment_received  +amount  (uang masuk)
CREDIT order_balance     -amount  (hutang lunas)
```

### FeeCalculated (3%)
```
DEBIT  fees_owed         +fee    (platform ambil fee)
CREDIT payment_received  -fee    (mengurangi balance)
```

### SettlementProcessed
```
DEBIT  seller_payout     +net    (transfer ke seller)
CREDIT payment_received  -net    (mengurangi balance platform)
```

## Fee Calculation

```
fee = amount × 0.03  (rounded to 4 decimal places, HALF_UP)
net_payout = amount - fee
```

## Decimal Precision Rules

1. Semua amounts disimpan sebagai `Decimal(18,4)` di DB
2. Semua kalkulasi menggunakan `decimal.js`, BUKAN native JS number
3. Semua API requests/responses menggunakan string, BUKAN number
4. Rounding: `ROUND_HALF_UP` sesuai standar akuntansi

## Verification

`GET /verify-ledger/:orderId` akan:
1. Sum semua debit entries untuk order tersebut
2. Sum semua credit entries untuk order tersebut
3. Assert `totalDebit - totalCredit = 0`
4. Throw `LedgerImbalanceError` kalau tidak balance
