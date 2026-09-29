/**
 * Rotary category dial — the criteria editor's "dialling telephone" ring.
 *
 * A short, fat ring cut into one wedge per catalog category, with a recessed
 * finger hole per wedge on a raised glass plate. Picking a wedge turns the whole
 * rotor until it lands under the fixed bottom notch (the finger stop) and the hub
 * reads out the category; hovering previews a wedge in the hub, because ten
 * wedges are too small to label. Each wedge carries a mark along the rim showing
 * the share of its criteria enabled, so picks are visible without turning.
 * Geometry lives in `@/lib/dial` (pure, unit-tested); this component renders it.
 *
 * Motion: the rotor is a plain element turned with a CSS transform, so the
 * browser composites it instead of repainting the SVG every frame (the reason a
 * rotating `<g>` looked choppy), and it snaps with a slight overshoot like a
 * real dial settling against the stop. The plate enters with a shallow
 * perspective tilt, matching the nav search panel. Reduced motion: no entrance,
 * instant turn.
 *
 * A11y: one `radiogroup`; every wedge is a focusable `radio` named for its
 * category, roving tabindex on the active one, arrows/Home/End turn the dial.
 * The focus indicator is a stroke on the wedge itself — `outline` draws a
 * rectangle around an SVG path's bounding box, which read as a stray square.
 */

import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Box, Text } from '@chakra-ui/react'
import {
  DIAL_HOLE_RADIUS,
  DIAL_VIEW,
  countArcPath,
  holePoint,
  rotationFor,
  wedgePath,
} from '@/lib/dial'

export interface DialSegment {
  category: string
  enabled: number
  total: number
}

export interface CategoryDialProps {
  /** Wedges in catalog order. */
  segments: DialSegment[]
  /** The chosen category. */
  value: string
  onValueChange: (category: string) => void
  reduced: boolean
}

function dialNumber(value: number): number {
  return Number(value.toFixed(2))
}

export function CategoryDial({ segments, value, onValueChange, reduced }: CategoryDialProps) {
  const [preview, setPreview] = useState<string | null>(null)

  if (segments.length === 0) return null

  const count = segments.length
  const index = Math.max(
    0,
    segments.findIndex((segment) => segment.category === value),
  )
  const rotation = dialNumber(rotationFor(index, count))
  const shown = segments.find((segment) => segment.category === (preview ?? value)) ?? segments[index]

  function onKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    let next = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next < 0) return
    event.preventDefault()
    onValueChange(segments[next].category)
  }

  return (
    <Box
      position="relative"
      w="100%"
      maxW="16rem"
      mx="auto"
      data-testid="category-dial"
      data-motion={reduced ? 'static' : 'animated'}
    >
      <Box className="dial-plate">
        {/* The rotor is a plain box: a CSS transform here is composited, an SVG
            transform on a <g> is repainted every frame. */}
        <Box
          data-testid="category-dial-ring"
          data-motion={reduced ? 'static' : 'animated'}
          data-rotation={rotation}
          className="dial-rotor"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <svg
            viewBox={`0 0 ${DIAL_VIEW} ${DIAL_VIEW}`}
            role="radiogroup"
            aria-label="Ratio category"
            className="block h-auto w-full"
            onKeyDown={onKeyDown}
          >
            {segments.map((segment, position) => {
              const hole = holePoint(position, count)
              return (
                <g key={segment.category}>
                  <path
                    d={wedgePath(position, count)}
                    role="radio"
                    aria-checked={position === index}
                    aria-label={segment.category}
                    tabIndex={position === index ? 0 : -1}
                    data-category={segment.category}
                    data-active={position === index ? 'true' : undefined}
                    className="dial-wedge"
                    onMouseEnter={() => setPreview(segment.category)}
                    onMouseLeave={() => setPreview(null)}
                    onFocus={() => setPreview(segment.category)}
                    onBlur={() => setPreview(null)}
                    onClick={() => onValueChange(segment.category)}
                  >
                    <title>{segment.category}</title>
                  </path>
                  <circle
                    data-testid="dial-hole"
                    data-category={segment.category}
                    data-active={position === index ? 'true' : undefined}
                    className="dial-hole"
                    cx={hole.x}
                    cy={hole.y}
                    r={DIAL_HOLE_RADIUS}
                    aria-hidden="true"
                    pointerEvents="none"
                  />
                  {segment.enabled > 0 ? (
                    <path
                      data-testid="dial-mark"
                      data-category={segment.category}
                      data-share={String(segment.enabled / segment.total)}
                      d={countArcPath(position, count, segment.enabled / segment.total)}
                      className="dial-mark"
                      fill="none"
                      strokeWidth={5}
                      strokeLinecap="round"
                      aria-hidden="true"
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
              )
            })}
          </svg>
        </Box>

        {/* Finger stop + hub stay put while the rotor turns. */}
        <svg
          viewBox={`0 0 ${DIAL_VIEW} ${DIAL_VIEW}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <polygon
            data-testid="dial-notch"
            points={`${DIAL_VIEW / 2},${DIAL_VIEW - 2} ${DIAL_VIEW / 2 - 8},${DIAL_VIEW - 13} ${DIAL_VIEW / 2 + 8},${DIAL_VIEW - 13}`}
            className="dial-notch"
          />
        </svg>

        <Box
          data-testid="dial-hub"
          position="absolute"
          inset="0"
          display="flex"
          flexDir="column"
          alignItems="center"
          justifyContent="center"
          textAlign="center"
          px="20%"
          pointerEvents="none"
        >
          <Text className="dial-hub-name" fontSize="sm" fontWeight="semibold" lineHeight="short">
            {shown.category}
          </Text>
          <Text fontSize="xs" color="fg.muted" className="font-mono tabular-nums">
            {shown.enabled}/{shown.total}
          </Text>
        </Box>
      </Box>

      <Text
        data-testid="dial-hint"
        mt={2}
        textAlign="center"
        fontSize="10px"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="fg.subtle"
      >
        Click a segment to switch category
      </Text>
    </Box>
  )
}

export default CategoryDial
