import { useCallback, useEffect, useRef, useState } from 'react'
import { useMotionValueEvent, type MotionValue } from 'motion/react'

import { SCROLL_SPAN, stageAt } from '@/components/three/pagodaScene'
import { TOWER_TIERS } from '@/content/tower'
import { readStage, writeStage } from '@/lib/scrollMemory'

/** The pixel offset of a stage's start. Every stage is one viewport tall. */
export function stageOffset(stage: number): number {
  return stage * window.innerHeight
}

/**
 * The landing page's one piece of shared state.
 *
 * Scroll produces `activeStage`; the accordion produces `openRow`. The 3D scene
 * samples the scroll `MotionValue` and the DOM reads both as plain numbers.
 *
 * There is no precedence rule between them, because there is no conflict to
 * arbitrate: an accordion lives *inside* its storey's section, so the storey it
 * belongs to is already the one on screen. Opening row 2 of storey 1 cannot ask
 * the tower to open storey 3 — the tower is driven by where you are, and the
 * accordion only decides how much of one storey's copy is showing. That is why
 * this hook is short.
 */
export function useLandingStage(progress: MotionValue<number>) {
  const [activeStage, setActiveStage] = useState(0)
  const [openRow, setOpenRow] = useState<number | null>(null)
  const restored = useRef(false)

  useMotionValueEvent(progress, 'change', (v) => {
    const s = stageAt(v)
    setActiveStage((prev) => (prev === s ? prev : s))
  })

  // Scroll memory. Restore once, after layout, or a scroll offset means nothing.
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const stage = readStage()
    if (stage === null || stage === 0) return
    const clamped = Math.min(SCROLL_SPAN, stage)
    // Two frames: the sections have to exist before a scroll position resolves.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo({ top: stageOffset(clamped), behavior: 'auto' }))
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Persist as it settles, not on every scroll event.
  useEffect(() => {
    const id = window.setTimeout(() => writeStage(activeStage), 250)
    return () => window.clearTimeout(id)
  }, [activeStage])

  /** The storey the scroll is on, or null for hero, overview and cta. */
  const openTier =
    activeStage >= 2 && activeStage <= 1 + TOWER_TIERS.length ? activeStage - 2 : null

  const onOpen = useCallback((row: number | null) => setOpenRow(row), [])

  /** Jump to a stage. Used by the rail and the overview list. */
  const goToStage = useCallback((stage: number) => {
    const clamped = Math.max(0, Math.min(SCROLL_SPAN, stage))
    window.scrollTo({ top: stageOffset(clamped), behavior: 'smooth' })
  }, [])

  return { activeStage, openTier, openRow, onOpen, goToStage }
}
