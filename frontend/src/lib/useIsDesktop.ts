import { useEffect, useState } from 'react'

const QUERY = '(min-width: 768px)'

function readInitial(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

/**
 * True on viewports >= md. 3D components mount only when this is true, so phones
 * never keep a render loop alive behind `hidden md:block` (see DESIGN.md 3D rules).
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(readInitial)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    setIsDesktop(mql.matches)

    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}
