/**
 * Pure, deterministic scene data for the login Sakura Garden (see DESIGN.md).
 *
 * No three.js here: this module only produces numbers, which keeps the geometry
 * builders unit-testable in jsdom and lets `SakuraScene.tsx` stay a component file
 * (so React Fast Refresh keeps working).
 */

/** Deterministic scene seed — the same tree and the same petal field on every load. */
export const TREE_SEED = 20260927
export const PETAL_COUNT = 70
/**
 * Petals spawn inside the lower canopy and fall away from it, so the top of the
 * blossom dome always sits above the petal cloud (see DESIGN.md → Sakura Garden).
 */
export const PETAL_SPAN = { minY: -2, maxY: 2, maxX: 2.4 }
const PETAL_WIND = 0.5

/** Hard instance budgets — the login scene must stay a cheap corner of the GPU. */
export const TREE_LIMITS = {
  maxSegments: 420,
  maxBlossoms: 1100,
  maxPetals: 90,
  maxDepth: 5,
  halfWidth: 2.8,
  maxHeight: 5.6,
}

type V3 = [number, number, number]

/** mulberry32 — tiny deterministic PRNG so the scene is identical on every load. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Adds an alpha channel to a token hex, producing `rgba(...)` for CSS gradients. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  )
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function normalise([x, y, z]: V3): V3 {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function cross([ax, ay, az]: V3, [bx, by, bz]: V3): V3 {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
}

export interface BranchSegment {
  start: V3
  end: V3
  radius: number
  depth: number
  /** 0 at the trunk, 1 at the outer twigs. */
  tone: number
}

export interface Blossom {
  position: V3
  size: number
  /** 0..1 across the blossom ramp. */
  tone: number
}

export interface TreeSpec {
  segments: BranchSegment[]
  blossoms: Blossom[]
  /** Highest branch point in local space. */
  height: number
}

/**
 * Recursive cherry tree shaped like the reference blossom: a short dark trunk that
 * lifts a broad, dense, rounded canopy — wider than it is tall, with the flowers
 * packed on the last two branch levels. Everything is deterministic for a seed.
 */
export function buildTree(seed = TREE_SEED): TreeSpec {
  const random = mulberry32(seed)
  const segments: BranchSegment[] = []
  const blossoms: Blossom[] = []
  const tips: V3[] = []
  let height = 0

  const stack: Array<{ start: V3; dir: V3; length: number; radius: number; depth: number }> = [
    { start: [0, -0.9, 0], dir: [0, 1, 0], length: 0.85, radius: 0.13, depth: 0 },
  ]

  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined || segments.length >= TREE_LIMITS.maxSegments) break

    const end: V3 = [
      node.start[0] + node.dir[0] * node.length,
      node.start[1] + node.dir[1] * node.length,
      node.start[2] + node.dir[2] * node.length,
    ]
    segments.push({
      start: node.start,
      end,
      radius: node.radius,
      depth: node.depth,
      tone: node.depth / TREE_LIMITS.maxDepth,
    })
    height = Math.max(height, end[1])

    // Flowers cover every canopy level, so the mass reads as blossom, not scaffolding.
    if (node.depth >= 1) {
      const clusters = node.depth >= 4 ? 5 : node.depth === 3 ? 4 : node.depth === 2 ? 3 : 2
      for (let index = 0; index < clusters; index += 1) {
        if (blossoms.length >= TREE_LIMITS.maxBlossoms) break
        blossoms.push({
          position: [
            end[0] + (random() - 0.5) * 0.34,
            end[1] + (random() - 0.5) * 0.34,
            end[2] + (random() - 0.5) * 0.34,
          ],
          size: 0.03 + random() * 0.035,
          tone: random(),
        })
      }
    }

    if (node.depth >= TREE_LIMITS.maxDepth) {
      tips.push(end)
      continue
    }

    const up: V3 = Math.abs(node.dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = normalise(cross(up, node.dir))
    const v = cross(node.dir, u)
    const trunk = node.depth < 1
    const children = random() < (trunk ? 0.85 : 0.62) ? 3 : 2

    for (let index = 0; index < children; index += 1) {
      // A short bare trunk, then the canopy bursts outward into a broad dome that
      // still leans up, with a light pull back so the silhouette stays rounded.
      const spread = trunk ? 0.3 + random() * 0.3 : 0.62 + random() * 0.5
      const azimuth = (index / children) * Math.PI * 2 + random() * 0.8
      const sideways = Math.sin(spread)
      const dir = normalise([
        node.dir[0] * Math.cos(spread) +
          (u[0] * Math.cos(azimuth) + v[0] * Math.sin(azimuth)) * sideways,
        node.dir[1] * Math.cos(spread) +
          (u[1] * Math.cos(azimuth) + v[1] * Math.sin(azimuth)) * sideways,
        node.dir[2] * Math.cos(spread) +
          (u[2] * Math.cos(azimuth) + v[2] * Math.sin(azimuth)) * sideways,
      ])
      if (trunk) {
        dir[1] += 0.55
      } else {
        dir[0] -= end[0] * 0.08
        dir[2] -= end[2] * 0.08
        dir[1] += 0.12 - 0.03 * node.depth
      }
      stack.push({
        start: end,
        dir: normalise(dir),
        length: node.length * (trunk ? 0.85 + random() * 0.12 : 0.72 + random() * 0.14),
        radius: node.radius * (trunk ? 0.78 : 0.6 + random() * 0.1),
        depth: node.depth + 1,
      })
    }
  }

  for (const tip of tips) {
    const clusters = 3 + Math.floor(random() * 3)
    for (let index = 0; index < clusters; index += 1) {
      if (blossoms.length >= TREE_LIMITS.maxBlossoms) break
      const angle = random() * Math.PI * 2
      const lift = (random() - 0.3) * 0.36
      const reach = Math.sqrt(random()) * 0.28
      blossoms.push({
        position: [tip[0] + Math.cos(angle) * reach, tip[1] + lift, tip[2] + Math.sin(angle) * reach],
        size: 0.03 + random() * 0.04,
        tone: random(),
      })
    }
  }

  return { segments, blossoms, height }
}

export interface TreeBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Extents of the grown tree in local units, blossoms included. The scene uses this to
 * scale the column to the viewport height and to keep it clear of the auth card.
 */
export function treeBounds(tree: TreeSpec): TreeBounds {
  const bounds: TreeBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const consider = (point: V3, padding: number) => {
    bounds.minX = Math.min(bounds.minX, point[0] - padding)
    bounds.maxX = Math.max(bounds.maxX, point[0] + padding)
    bounds.minY = Math.min(bounds.minY, point[1] - padding)
    bounds.maxY = Math.max(bounds.maxY, point[1] + padding)
  }
  for (const segment of tree.segments) {
    consider(segment.start, segment.radius)
    consider(segment.end, segment.radius)
  }
  for (const blossom of tree.blossoms) consider(blossom.position, blossom.size)
  return bounds
}

/** Half the auth-card container (5xl) in CSS pixels. */
export const CARD_HALF_CONTAINER_PX = 512
/** The auth card itself (`md` width); below lg it is centred on its own. */
export const CARD_WIDTH_PX = 448
/** Breathing room between the card's right edge and the tree's left edge. */
export const CARD_GAP_PX = 24
/** The login page's own horizontal padding (md:px-8, base:px-5). */
const CARD_PADDING_PX = 32
/** The trunk runs this fraction of the viewport height. */
export const TREE_HEIGHT_FRACTION = 0.78

export interface SceneLayout {
  /** World units per local unit. */
  scale: number
  /** Group position that puts the tree in the right-hand band. */
  position: V3
  /** World x of the tree's left edge. */
  treeLeft: number
  /** World x of the auth card's right edge. */
  cardRight: number
}

/**
 * Layout for the right-hand tree: scaled so the trunk runs most of the viewport
 * height and positioned so its left edge stays clear of the auth card at every width
 * ≥ md. `cssWidth` is the viewport width in CSS pixels, which is what the page layout
 * (and therefore the card) is measured in.
 */
export function treePlacement(
  bounds: TreeBounds,
  viewport: { width: number; height: number; cssWidth: number },
): SceneLayout {
  const height = Math.max(0.001, bounds.maxY - bounds.minY)
  const scale = (viewport.height * TREE_HEIGHT_FRACTION) / height
  const px = Math.max(1, viewport.cssWidth)
  // At lg+ the page is a centred 5xl container with the card at its right end; below lg
  // the single-column card is centred. Both are measured in CSS pixels, so the card's
  // right edge is a known offset from the viewport centre.
  const containerWidth = Math.min(Math.max(0, px - CARD_PADDING_PX * 2), CARD_HALF_CONTAINER_PX * 2)
  const halfCard =
    px >= 1024 ? containerWidth / 2 : Math.min(CARD_WIDTH_PX / 2, containerWidth / 2)
  const cardRightPx = Math.min(px / 2 + halfCard, px)
  // Convert "pixels from the left" into the centred world axis the camera uses.
  const cardRight = (cardRightPx / px - 0.5) * viewport.width
  const gap = (CARD_GAP_PX / px) * viewport.width
  const treeLeft = Math.max(cardRight + gap, 0)
  const groupX = treeLeft - scale * bounds.minX
  return {
    scale,
    position: [groupX, -viewport.height / 2 - 0.05 - scale * bounds.minY, 0],
    treeLeft,
    cardRight,
  }
}

export interface PetalSeed {
  /** Canopy spawn point on the local x/z plane. */
  origin: V3
  /** Vertical offset into the fall so petals are spread out from the first frame. */
  yPhase: number
  fallSpeed: number
  swayAmp: number
  swayPhase: number
  swaySpeed: number
  spinAxis: V3
  spinSpeed: number
  scale: number
}

export interface PetalPose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

/** The falling flock — deterministic positions, speeds, drift and spin. */
export function petalSeeds(seed = TREE_SEED, count = PETAL_COUNT): PetalSeed[] {
  const random = mulberry32(seed ^ 0x9e3779b9)
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2
    const reach = Math.sqrt(random()) * 1.5
    return {
      origin: [Math.cos(angle) * reach, 0, Math.sin(angle) * reach * 0.55],
      yPhase: random() * (PETAL_SPAN.maxY - PETAL_SPAN.minY),
      fallSpeed: 0.1 + random() * 0.14,
      swayAmp: 0.1 + random() * 0.2,
      swayPhase: random() * Math.PI * 2,
      swaySpeed: 0.4 + random() * 0.6,
      spinAxis: [random() - 0.5, random() - 0.5, random() - 0.5],
      spinSpeed: 0.3 + random() * 0.9,
      scale: 0.8 + random() * 0.5,
    }
  })
}

/**
 * Pure fall function: a petal sinks at `fallSpeed`, sways on its own sine, drifts
 * left with the wind in proportion to how far it has fallen, and wraps back to the
 * canopy once it reaches the ground.
 */
export function petalPose(seed: PetalSeed, time: number): PetalPose {
  const range = PETAL_SPAN.maxY - PETAL_SPAN.minY
  const progress = (seed.fallSpeed * time + seed.yPhase) % range
  const fall = progress / range
  const spin = seed.spinSpeed * time
  return {
    x:
      seed.origin[0] +
      seed.swayAmp * Math.sin(seed.swaySpeed * time + seed.swayPhase) -
      fall * PETAL_WIND,
    y: PETAL_SPAN.maxY - progress,
    z: seed.origin[2] + 0.3 * Math.sin(seed.swaySpeed * 0.7 * time + seed.swayPhase),
    rx: spin * 0.9 + seed.swayPhase,
    ry: spin * 1.3,
    rz: spin * 0.6 + seed.swayPhase * 0.5,
  }
}
