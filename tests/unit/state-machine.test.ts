import { isValidTransition, VALID_TRANSITIONS, OrderStatus } from '../../src/domain/events/event-types'

describe('Order State Machine', () => {
  it('allows valid transitions', () => {
    expect(isValidTransition('PENDING', 'PAYMENT_PROCESSING')).toBe(true)
    expect(isValidTransition('PAYMENT_PROCESSING', 'PAYMENT_CONFIRMED')).toBe(true)
    expect(isValidTransition('PAYMENT_CONFIRMED', 'FEE_CALCULATED')).toBe(true)
    expect(isValidTransition('FEE_CALCULATED', 'SHIPPED')).toBe(true)
    expect(isValidTransition('SHIPPED', 'DELIVERED')).toBe(true)
  })

  it('allows refund from multiple states', () => {
    expect(isValidTransition('PAYMENT_CONFIRMED', 'REFUNDED')).toBe(true)
    expect(isValidTransition('FEE_CALCULATED', 'REFUNDED')).toBe(true)
    expect(isValidTransition('SHIPPED', 'REFUNDED')).toBe(true)
    expect(isValidTransition('DELIVERED', 'REFUNDED')).toBe(true)
  })

  it('blocks invalid transitions', () => {
    expect(isValidTransition('PENDING', 'PAYMENT_CONFIRMED')).toBe(false)
    expect(isValidTransition('PENDING', 'FEE_CALCULATED')).toBe(false)
    expect(isValidTransition('PENDING', 'SHIPPED')).toBe(false)
    expect(isValidTransition('PAYMENT_CONFIRMED', 'PENDING')).toBe(false)
    expect(isValidTransition('SHIPPED', 'PAYMENT_CONFIRMED')).toBe(false)
  })

  it('terminal states have no transitions', () => {
    expect(VALID_TRANSITIONS['REFUNDED']).toEqual([])
    expect(VALID_TRANSITIONS['FAILED']).toEqual([])
  })

  it('allows PENDING to FAILED', () => {
    expect(isValidTransition('PENDING', 'FAILED')).toBe(true)
    expect(isValidTransition('PAYMENT_PROCESSING', 'FAILED')).toBe(true)
  })
})
