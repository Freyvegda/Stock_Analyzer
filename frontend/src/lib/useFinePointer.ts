import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: fine)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function read() {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/** Reactive `(pointer: fine)` capability (2-in-1 detach/attach, tablet + mouse). */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
