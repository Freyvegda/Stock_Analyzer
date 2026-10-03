import { getConfig } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('test setup', () => {
  it('gives async queries room for a loaded machine', () => {
    // vitest.config.ts raises the test timeout, but Testing Library's own
    // findBy/waitFor budget is separate and defaults to 1000 ms — too tight
    // when jsdom, motion and lazy three chunks share a loaded machine.
    expect(getConfig().asyncUtilTimeout).toBe(3000)
  })
})
