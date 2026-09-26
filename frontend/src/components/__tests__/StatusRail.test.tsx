import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusProvider, StatusRail, useStatusFact } from '../StatusRail'

function Publish({ area, text }: { area: string; text: string | null }) {
  useStatusFact(area, text)
  return null
}

describe('StatusRail', () => {
  it('renders nothing without facts', () => {
    render(
      <StatusProvider>
        <StatusRail />
      </StatusProvider>,
    )
    expect(screen.queryByTestId('status-rail')).not.toBeInTheDocument()
  })

  it('renders published facts', () => {
    render(
      <StatusProvider>
        <Publish area="screen" text="12 shortlisted" />
        <Publish area="docs" text="34/40 parsed" />
        <StatusRail />
      </StatusProvider>,
    )
    const rail = screen.getByTestId('status-rail')
    expect(rail).toHaveTextContent('screen 12 shortlisted')
    expect(rail).toHaveTextContent('docs 34/40 parsed')
  })

  it('clears a fact when it is re-published as null', () => {
    const { rerender } = render(
      <StatusProvider>
        <Publish area="screen" text="12 shortlisted" />
        <StatusRail />
      </StatusProvider>,
    )
    expect(screen.getByTestId('status-rail')).toHaveTextContent('12 shortlisted')

    rerender(
      <StatusProvider>
        <Publish area="screen" text={null} />
        <StatusRail />
      </StatusProvider>,
    )
    expect(screen.queryByTestId('status-rail')).not.toBeInTheDocument()
  })

  it('replaces a fact when the same area is republished', () => {
    const { rerender } = render(
      <StatusProvider>
        <Publish area="screen" text="12 shortlisted" />
        <StatusRail />
      </StatusProvider>,
    )
    rerender(
      <StatusProvider>
        <Publish area="screen" text="13 shortlisted" />
        <StatusRail />
      </StatusProvider>,
    )
    const rail = screen.getByTestId('status-rail')
    expect(rail).toHaveTextContent('13 shortlisted')
    expect(rail).not.toHaveTextContent('12 shortlisted')
  })
})
