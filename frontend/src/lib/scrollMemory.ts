/**
 * Where the visitor left the landing page.
 *
 * `sessionStorage`, deliberately not `localStorage`: the auth token store already
 * forbids persisting anything in `localStorage`, and a scroll position that
 * outlives the tab would drop a returning visitor mid-story with no memory of how
 * they got there. Within a session it is exactly right — a refresh or a
 * back-navigation restores the storey they were reading.
 *
 * Every access is guarded. Storage throws in a few real configurations (Safari in
 * private mode on `setItem`, some enterprise policies on `getItem`), and a
 * missing scroll memory is a cosmetic loss — a thrown error here would take the
 * whole landing page down with it.
 */

const KEY = 'landing.stage'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * The stage the visitor was last on, or null if there is not a usable one.
 *
 * Anything that is not a non-negative integer is treated as absent. Storage is
 * shared and hand-editable, so a bad value must not put the page into a state it
 * cannot render.
 */
export function readStage(): number | null {
  try {
    const raw = storage()?.getItem(KEY)
    if (raw === null || raw === undefined) return null
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) return null
    return value
  } catch {
    return null
  }
}

export function writeStage(stage: number): void {
  if (!Number.isInteger(stage) || stage < 0) return
  try {
    storage()?.setItem(KEY, String(stage))
  } catch {
    // Storage is full, or blocked. The page works without it.
  }
}

export function clearStage(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // Nothing to do: it is already not written.
  }
}
