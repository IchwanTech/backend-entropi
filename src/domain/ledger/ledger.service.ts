import { AccountType, LedgerEntry, TransactionClient } from '../../db/types'
import { Decimal, toDecimal, formatAmount } from '../../lib/decimal'
import { LedgerImbalanceError } from '../../lib/errors'

export class LedgerService {
  constructor(private readonly db: any) {}

  async recordDoubleEntry(
    tx: TransactionClient,
    params: {
      orderId: string
      debitAccount: AccountType
      creditAccount: AccountType
      amount: Decimal
      description?: string
    },
  ): Promise<[LedgerEntry, LedgerEntry]> {
    const { orderId, debitAccount, creditAccount, amount, description } = params
    const amountStr = formatAmount(amount)

    const [debitEntry, creditEntry] = await Promise.all([
      tx.ledgerEntry.create({
        data: { orderId, account: debitAccount, debit: amountStr, credit: null, description },
      }),
      tx.ledgerEntry.create({
        data: { orderId, account: creditAccount, debit: null, credit: amountStr, description },
      }),
    ])

    return [debitEntry, creditEntry]
  }

  async verifyBalance(orderId: string): Promise<{ balanced: boolean; difference: string }> {
    const entries = await this.db.ledgerEntry.findMany({
      where: { orderId },
      select: { debit: true, credit: true },
    })

    let totalDebit = new Decimal(0)
    let totalCredit = new Decimal(0)

    for (const entry of entries as LedgerEntry[]) {
      if (entry.debit !== null) totalDebit = totalDebit.add(toDecimal(entry.debit.toString()))
      if (entry.credit !== null) totalCredit = totalCredit.add(toDecimal(entry.credit.toString()))
    }

    const difference = totalDebit.sub(totalCredit)
    if (!difference.isZero()) throw new LedgerImbalanceError(orderId, formatAmount(difference))

    return { balanced: true, difference: '0.0000' }
  }

  async getAuditTrail(orderId: string): Promise<AuditTrailEntry[]> {
    const entries = await this.db.ledgerEntry.findMany({
      where: { orderId },
      orderBy: { timestamp: 'asc' },
    }) as LedgerEntry[]

    let runningBalance = new Decimal(0)

    return entries.map((entry) => {
      const debit = entry.debit ? toDecimal(entry.debit.toString()) : new Decimal(0)
      const credit = entry.credit ? toDecimal(entry.credit.toString()) : new Decimal(0)
      runningBalance = runningBalance.add(debit).sub(credit)

      return {
        id: entry.id,
        account: entry.account,
        debit: entry.debit ? formatAmount(toDecimal(entry.debit.toString())) : null,
        credit: entry.credit ? formatAmount(toDecimal(entry.credit.toString())) : null,
        runningBalance: formatAmount(runningBalance),
        description: entry.description,
        timestamp: entry.timestamp.toISOString(),
      }
    })
  }

  async calculatePendingPayout(orderId: string): Promise<Decimal> {
    const entries = await this.db.ledgerEntry.findMany({
      where: { orderId, account: { in: ['payment_received', 'fees_owed'] } },
    }) as LedgerEntry[]

    let netPayout = new Decimal(0)

    for (const entry of entries) {
      if (entry.account === 'payment_received') {
        if (entry.credit !== null) netPayout = netPayout.sub(toDecimal(entry.credit.toString()))
        if (entry.debit !== null) netPayout = netPayout.add(toDecimal(entry.debit.toString()))
      }
      if (entry.account === 'fees_owed') {
        if (entry.debit !== null) netPayout = netPayout.sub(toDecimal(entry.debit.toString()))
      }
    }

    return netPayout
  }
}

export interface AuditTrailEntry {
  id: string
  account: AccountType
  debit: string | null
  credit: string | null
  runningBalance: string
  description: string | null
  timestamp: string
}
