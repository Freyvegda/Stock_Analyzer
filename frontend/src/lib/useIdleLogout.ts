import { useEffect, useRef } from 'react'

/**
 * Sliding idle timer. Calls `onIdle` after `idleMs` without *real* user
 * activity, and then stops: once the user is out, activity must not re-arm it.
 *
 * Why this exists next to the server's own 3-hour check: the server only learns
 * of activity when a request arrives, so a tab left open and forgotten is
 * invisible to it, and a laptop that was closed is a session that should already
 * be dead. The client timer covers the first case, the server the second.
 */

/** Events that mean a person is actually doing something. */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const

/** A held-down key or a flung scrollbar fires far faster than this. */
const THROTTLE_MS = 60_000

export const IDLE_LOGOUT_MS = 3 * 60 * 60 * 1000

export function useIdleLogout(
  onIdle: () => void,
  idleMs: number = IDLE_LOGOUT_MS,
  enabled = true,
): void {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return

    let fired = false
    let timer: ReturnType<typeof setTimeout>
    let lastCheck = 0

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fired = true
        onIdleRef.current()
      }, idleMs)
    }

    const onActivity = () => {
      if (fired) return // already logged out; do not resurrect the session
      const now = Date.now()
      if (now - lastCheck < THROTTLE_MS) return
      lastCheck = now
      schedule()
    }

    lastCheck = Date.now()
    schedule()
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true })
    }
    return () => {
      clearTimeout(timer)
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity)
      }
    }
  }, [idleMs, enabled])
}
