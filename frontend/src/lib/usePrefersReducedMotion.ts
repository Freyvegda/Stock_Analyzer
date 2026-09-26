import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function readInitial(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readInitial)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    setReduced(mql.matches)

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
