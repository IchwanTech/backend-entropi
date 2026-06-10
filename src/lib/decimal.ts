import Decimal from 'decimal.js'

// Global config: 18 digit presisi, ROUND_HALF_UP sesuai standar akuntansi
Decimal.set({ precision: 18, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

// Konstanta fee rate: 3%
export const FEE_RATE = new Decimal('0.03')

// Buat Decimal dari berbagai input type
export function toDecimal(value: string | number | Decimal): Decimal {
  return new Decimal(value)
}

// Kalkulasi fee dari amount
export function calculateFee(amount: Decimal): Decimal {
  return amount.mul(FEE_RATE).toDecimalPlaces(4)
}

// Kalkulasi payout (amount - fee)
export function calculatePayout(amount: Decimal): Decimal {
  return amount.sub(calculateFee(amount)).toDecimalPlaces(4)
}

// Serialisasi ke string untuk API response (selalu 4 desimal)
export function formatAmount(value: Decimal): string {
  return value.toFixed(4)
}

// Guard: pastikan amount positif dan valid
export function assertPositive(value: Decimal, field = 'amount'): void {
  if (value.lte(0)) {
    throw new Error(`${field} must be positive, got ${value.toString()}`)
  }
}
