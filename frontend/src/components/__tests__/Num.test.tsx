import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Num } from '../ui/Num'

describe('Num', () => {
  it('renders mono tabular numerals', () => {
    render(<Num>42.5</Num>)
    const element = screen.getByText('42.5')
    expect(element.className).toContain('font-mono')
    expect(element.className).toContain('tabular-nums')
  })

  it('keeps caller class names', () => {
    render(<Num className="text-right">7</Num>)
    const element = screen.getByText('7')
    expect(element.className).toContain('text-right')
    expect(element.className).toContain('font-mono')
  })
})
