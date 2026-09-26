import { describe, expect, it } from 'vitest'
import { formatElapsed } from './format'

describe('formatElapsed', () => {
  it('formats zero as 00:00', () => {
    expect(formatElapsed(0)).toBe('00:00')
  })

  it('formats seconds with two digits', () => {
    expect(formatElapsed(5)).toBe('00:05')
  })

  it('rolls minutes over at 60 seconds', () => {
    expect(formatElapsed(61)).toBe('01:01')
  })

  it('keeps counting minutes past an hour', () => {
    expect(formatElapsed(3661)).toBe('61:01')
  })

  it('clamps negative and fractional input', () => {
    expect(formatElapsed(-3)).toBe('00:00')
    expect(formatElapsed(9.7)).toBe('00:09')
  })
})
