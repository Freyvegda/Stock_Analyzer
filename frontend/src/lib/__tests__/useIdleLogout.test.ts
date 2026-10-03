/**
 * 3h sliding idle: real user activity keeps the session alive, and silence logs
 * the user out. The client timer catches an idle *tab*; the server's
 * `last_seen_at` backstop catches a closed laptop that reopens. Neither alone
 * covers the case, which is why both exist.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIdleLogout } from '../useIdleLogout'

const HOUR = 60 * 60 * 1000
const IDLE_MS = 3 * HOUR

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Advance the clock and let React flush. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function fire(type: string) {
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']

describe('useIdleLogout', () => {
  it('does not log out before the idle window elapses', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS - 1000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('logs out after three hours of silence', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it.each(ACTIVITY)('treats %s as activity that defers the timeout', (type) => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS - 60_000)
    fire(type)
    tick(60_000) // only a minute since the last activity
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('restarts the full window on activity', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS - 1)
    fire('keydown')
    tick(IDLE_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()
    tick(2)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('fires once, not once per event after expiry', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS)
    tick(IDLE_MS)
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('stops listening after unmount', () => {
    const onIdle = vi.fn()
    const { unmount } = renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    unmount()
    tick(IDLE_MS)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('activity after expiry does not re-arm the timer', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce()
    fire('pointerdown')
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce() // already logged out; do not keep them out
  })

  it('ignores the mouse merely moving across the page', () => {
    // mousemove fires constantly; counting it would make the timer unarmable.
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    tick(IDLE_MS - 1000)
    fire('mousemove')
    tick(2000)
    expect(onIdle).toHaveBeenCalled()
  })

  it('throttles bursts of activity to one timer reset per minute', () => {
    // A held-down scroll or key-repeat must not reschedule on every event.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    renderHook(() => useIdleLogout(onIdleSpy(), IDLE_MS))

    act(() => {
      for (let i = 0; i < 200; i += 1) {
        window.dispatchEvent(new Event('scroll'))
        vi.advanceTimersByTime(5)
      }
    })
    const resets = setTimeoutSpy.mock.calls.filter((c) => c[1] === IDLE_MS).length
    setTimeoutSpy.mockRestore()
    expect(resets).toBeLessThan(200)
  })

  it('still honours a long-idle gap after a throttled burst', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(IDLE_MS + 1000)
    })
    expect(onIdle).toHaveBeenCalledOnce()
  })
})

describe('useIdleLogout enabled', () => {
  it('does not fire while disabled', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleLogout(onIdle, IDLE_MS, false))
    tick(IDLE_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('arms the window when it becomes enabled', () => {
    // A visitor who reads the login page for 3h and then signs in must get a
    // full window, not be logged out one second later.
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useIdleLogout(onIdle, IDLE_MS, enabled),
      { initialProps: { enabled: false } },
    )
    tick(IDLE_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()

    rerender({ enabled: true })
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('re-arms when re-enabled after a fire', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useIdleLogout(onIdle, IDLE_MS, enabled),
      { initialProps: { enabled: true } },
    )
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledOnce()

    rerender({ enabled: false })
    rerender({ enabled: true })
    tick(IDLE_MS)
    expect(onIdle).toHaveBeenCalledTimes(2) // a new sign-in deserves a new window
  })
})

function onIdleSpy() {
  return vi.fn()
}
