import { describe, expect, it } from 'vitest'
import { formatPrice } from '../price'

describe('formatPrice', () => {
  it('truncates to two decimals', () => {
    expect(formatPrice(1167.699951171875)).toBe('1167.70')
  })

  it('pads whole numbers', () => {
    expect(formatPrice(110)).toBe('110.00')
  })

  it('keeps one-decimal inputs at two places', () => {
    expect(formatPrice(3100.5)).toBe('3100.50')
  })
})
