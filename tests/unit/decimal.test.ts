import { Decimal } from '../../src/lib/decimal'
import {
  toDecimal,
  calculateFee,
  calculatePayout,
  formatAmount,
  assertPositive,
  FEE_RATE,
} from '../../src/lib/decimal'

describe('Decimal Precision', () => {
  // Test: 3% dari $10 = $0.30 (bukan 0.30000000000000004 dari float)
  it('calculates 3% fee without floating point error', () => {
    const amount = toDecimal('10.00')
    const fee = calculateFee(amount)
    expect(fee.toFixed(4)).toBe('0.3000')
  })

  // Test: fee dari $999,999.99 harus presisi
  it('handles large amounts correctly', () => {
    const amount = toDecimal('999999.99')
    const fee = calculateFee(amount)
    const payout = calculatePayout(amount)

    // 999999.99 * 0.03 = 29999.9997
    expect(fee.toFixed(4)).toBe('29999.9997')
    // payout = 999999.99 - 29999.9997 = 969999.9903
    expect(payout.toFixed(4)).toBe('969999.9903')
    // fee + payout = amount
    expect(fee.add(payout).toFixed(4)).toBe('999999.9900')
  })

  // Test: fee dari $1.00 = $0.0300
  it('handles minimum amount $1.00', () => {
    const amount = toDecimal('1.00')
    const fee = calculateFee(amount)
    expect(fee.toFixed(4)).toBe('0.0300')
  })

  // Test: 10 kali $0.03 = $0.30 (bukan $0.30000000000000004)
  it('10 * 0.03 = 0.30 exactly', () => {
    let sum = new Decimal(0)
    for (let i = 0; i < 10; i++) {
      sum = sum.add(new Decimal('0.03'))
    }
    expect(sum.toFixed(2)).toBe('0.30')
  })

  // Test: Decimal tidak sama dengan float behavior
  it('avoids classic JS float errors', () => {
    // Ini gagal dengan native JS: 0.1 + 0.2 !== 0.3
    const jsFloat = 0.1 + 0.2
    expect(jsFloat).not.toBe(0.3) // JS float error

    // Tapi dengan Decimal, hasilnya tepat
    const decimal = toDecimal('0.1').add(toDecimal('0.2'))
    expect(decimal.toFixed(1)).toBe('0.3') // ✓
  })

  it('formatAmount always returns 4 decimal places', () => {
    expect(formatAmount(toDecimal('100'))).toBe('100.0000')
    expect(formatAmount(toDecimal('0.5'))).toBe('0.5000')
    expect(formatAmount(toDecimal('1234.5678'))).toBe('1234.5678')
  })

  it('assertPositive throws for zero or negative', () => {
    expect(() => assertPositive(toDecimal('0'))).toThrow()
    expect(() => assertPositive(toDecimal('-1'))).toThrow()
    expect(() => assertPositive(toDecimal('0.0001'))).not.toThrow()
  })

  it('fee rate is exactly 3%', () => {
    expect(FEE_RATE.toFixed(2)).toBe('0.03')
  })
})
