import { describe, expect, it } from 'vitest'
import { RATIO_INFO } from '../ratioInfo'

describe('ratioInfo', () => {
  it('explains core valuation and profitability ratios', () => {
    for (const key of ['pe', 'pb', 'roe', 'roce', 'debt_to_equity', 'dividendYield']) {
      expect(RATIO_INFO[key], `missing info for ${key}`).toBeDefined()
      expect(RATIO_INFO[key].length).toBeGreaterThan(20)
    }
  })

  it('has no placeholder text', () => {
    for (const [key, text] of Object.entries(RATIO_INFO)) {
      expect(text.toLowerCase()).not.toContain('tbd')
      expect(text.toLowerCase()).not.toContain('todo')
      expect(key).not.toBe('')
    }
  })
})
