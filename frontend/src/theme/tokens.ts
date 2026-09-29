/**
 * Single source of truth for the Sakura Vault palette (see DESIGN.md).
 *
 * `src/index.css` contains a marked block (`@vault-tokens:start/end`) that is
 * generated from these values and guarded by `tokens.sync.test.ts`; never edit
 * the block by hand. Run `$env:VAULT_SYNC='1'; npm run tokens:sync` after
 * changing a value here.
 */

export interface ThemeTokens {
  background: string
  foreground: string
  card: string
  cardForeground: string
  /**
   * Floating overlay surface (the auth card). Keep it separate from `card` so an
   * overlay can carry a warmer tint than the page's own cards.
   */
  panel: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  border: string
  input: string
  ring: string
  gain: string
  loss: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

export const dark: ThemeTokens = {
  background: '#0C080B',
  foreground: '#F2EAF0',
  card: '#140F13',
  cardForeground: '#F2EAF0',
  panel: '#201821',
  popover: '#201821',
  popoverForeground: '#F2EAF0',
  primary: '#FFA9C6',
  primaryForeground: '#2B0D1A',
  secondary: '#1A1219',
  secondaryForeground: '#F2EAF0',
  muted: '#120D11',
  mutedForeground: '#A4939E',
  accent: '#1A1219',
  accentForeground: '#F2EAF0',
  destructive: '#FF6B7A',
  border: '#2C2129',
  input: '#2C2129',
  ring: '#FFA9C6',
  gain: '#3DD68C',
  loss: '#FF6B7A',
  chart1: '#FFA9C6',
  chart2: '#8FB8D8',
  chart3: '#3DD68C',
  chart4: '#FF6B7A',
  chart5: '#9A8B96',
  sidebar: '#140F13',
  sidebarForeground: '#F2EAF0',
  sidebarPrimary: '#FFA9C6',
  sidebarPrimaryForeground: '#2B0D1A',
  sidebarAccent: '#1A1219',
  sidebarAccentForeground: '#F2EAF0',
  sidebarBorder: '#2C2129',
  sidebarRing: '#FFA9C6',
}

export const light: ThemeTokens = {
  background: '#FBF6F8',
  foreground: '#1A1116',
  card: '#FFFFFF',
  cardForeground: '#1A1116',
  panel: '#FDF2F6',
  popover: '#FFFFFF',
  popoverForeground: '#1A1116',
  primary: '#B0336A',
  primaryForeground: '#FFF6FA',
  secondary: '#F3E7EC',
  secondaryForeground: '#1A1116',
  muted: '#F5EDF0',
  mutedForeground: '#6E5F68',
  accent: '#F3E7EC',
  accentForeground: '#1A1116',
  destructive: '#B91C1C',
  border: '#E7D8DF',
  input: '#DCC9D2',
  ring: '#B0336A',
  gain: '#15803D',
  loss: '#B91C1C',
  chart1: '#B0336A',
  chart2: '#4C6E8F',
  chart3: '#15803D',
  chart4: '#B91C1C',
  chart5: '#7A6A73',
  sidebar: '#FFFFFF',
  sidebarForeground: '#1A1116',
  sidebarPrimary: '#B0336A',
  sidebarPrimaryForeground: '#FFF6FA',
  sidebarAccent: '#F3E7EC',
  sidebarAccentForeground: '#1A1116',
  sidebarBorder: '#E7D8DF',
  sidebarRing: '#B0336A',
}

/** Custom sakura scale (Chakra `colors.sakura.*` + `colorPalette="sakura"`). */
export const sakuraScale: Record<number, string> = {
  50: '#FFF5F8',
  100: '#FFE7EF',
  200: '#FFC9DD',
  300: '#FFA9C6',
  400: '#FF8FB5',
  500: '#F472A5',
  600: '#DB4E8A',
  700: '#B0336A',
  800: '#8C2753',
  900: '#6B1D40',
  950: '#4A1029',
}

export interface ChartPalette {
  grid: string
  crosshair: string
  candleUp: string
  candleDown: string
  strategy: string
  benchmark: string
}

/** Concrete values for chart libraries (lightweight-charts/recharts) — no hardcoded hex in charts. */
export const chartPalette: { dark: ChartPalette; light: ChartPalette } = {
  dark: {
    grid: 'rgba(255, 255, 255, 0.06)',
    crosshair: 'rgba(255, 169, 198, 0.5)',
    candleUp: dark.gain,
    candleDown: dark.loss,
    strategy: dark.primary,
    benchmark: dark.chart2,
  },
  light: {
    grid: 'rgba(20, 24, 31, 0.06)',
    crosshair: 'rgba(176, 51, 106, 0.5)',
    candleUp: light.gain,
    candleDown: light.loss,
    strategy: light.primary,
    benchmark: light.chart2,
  },
}

/** Selects the palette for a resolved colour mode (light until proven dark). */
export function paletteFor(colorMode: string | undefined): ThemeTokens {
  return colorMode === 'dark' ? dark : light
}

/**
 * Login-only "Sakura Garden" scene colours (see DESIGN.md → Sakura Garden).
 *
 * Deliberately outside {@link ThemeTokens}: these never become CSS variables, never
 * touch the synced `index.css` block, and are only ever read by the login 3D scene.
 * Colours reach three.js as props, so `components/three/**` stays hex-free.
 */
export interface ScenePalette {
  /** Sky gradient, from the top of the viewport down to the horizon. */
  skyTop: string
  skyBottom: string
  /** Moon (dark) / sun (light) — same slot, crossfaded on theme change. */
  celestial: string
  celestialHalo: string
  celestialDeep: string
  bark: string
  blossomLight: string
  blossomMid: string
  blossomDeep: string
  petal: string
  groundGlow: string
  star: string
}

export const scenePalette: { dark: ScenePalette; light: ScenePalette } = {
  dark: {
    skyTop: '#04060B',
    skyBottom: '#171021',
    celestial: '#EDF1FA',
    celestialHalo: '#9AA8C6',
    celestialDeep: '#BCC5D9',
    bark: '#4A3833',
    blossomLight: '#FFD3E4',
    blossomMid: '#F5A6C6',
    blossomDeep: '#C4708F',
    petal: '#FFC2DA',
    groundGlow: '#8A5A72',
    star: '#DCE4F5',
  },
  light: {
    // Blue zenith fading to warm sand at the horizon.
    skyTop: '#2E5474',
    skyBottom: '#F3E2CE',
    celestial: '#FFC98A',
    celestialHalo: '#FFD9A0',
    celestialDeep: '#E08A2B',
    bark: '#4A332C',
    blossomLight: '#FFD3E4',
    blossomMid: '#F7A8C9',
    blossomDeep: '#D4709C',
    petal: '#FBBBD5',
    groundGlow: '#C08A6E',
    star: '#FFFFFF',
  },
}

/** Selects the sakura scene palette for a resolved colour mode (day until proven night). */
export function scenePaletteFor(colorMode: string | undefined): ScenePalette {
  return colorMode === 'dark' ? scenePalette.dark : scenePalette.light
}

/**
 * Bonfire scene colours (see DESIGN.md → Bonfire).
 *
 * Same contract as {@link ScenePalette}: outside {@link ThemeTokens}, never a CSS
 * variable, passed to three.js as props so `components/three/**` stays hex-free.
 * The flame runs warm cream at the core and cools through peach to sakura pink at the
 * tips — real fire, dressed in the vault's own hue rather than neon pink.
 */
export interface BonfirePalette {
  /** Hottest, innermost flame layer. */
  flameCore: string
  /** Middle flame layer — the amber body of the fire. */
  flameMid: string
  /** Outer flame layer and licks — sakura at the tips. */
  flameTip: string
  /** Airborne ember streaks. */
  ember: string
  /** Hottest ember streaks, near the flame mouth. */
  emberHot: string
  /** Charred logs under the flame. */
  log: string
  /** Stone ring around the fire. */
  stone: string
  /** Ground bloom / haze tint. */
  glow: string
}

export const bonfirePalette: { dark: BonfirePalette; light: BonfirePalette } = {
  dark: {
    // Moonlit night: a bright campfire against near-black. The bloom is additive,
    // embers are amber streaks with a few white-hot ones, the licks stay sakura.
    flameCore: '#FFF3D6',
    flameMid: '#FFB877',
    flameTip: '#FF8FB5',
    ember: '#FFAF6E',
    emberHot: '#FFE3A3',
    log: '#4A3833',
    stone: '#3A2E36',
    glow: '#C4708F',
  },
  light: {
    // Petal Paper: deeper fire tones so the flame holds against near-white; the
    // bloom becomes a soft blush veil (normal blending, low opacity) instead of glow
    // and the embers read as dark amber flecks, the way sparks look in daylight.
    flameCore: '#FFD9A8',
    flameMid: '#F08553',
    flameTip: '#D9558C',
    ember: '#B4571F',
    emberHot: '#D88A2E',
    log: '#5A443C',
    stone: '#6B5A64',
    glow: '#DB4E8A',
  },
}

/** Selects the bonfire palette for a resolved colour mode (day until proven night). */
export function bonfirePaletteFor(colorMode: string | undefined): BonfirePalette {
  return colorMode === 'dark' ? bonfirePalette.dark : bonfirePalette.light
}

export interface PagodaPalette {
  /** Storey body — the plastered wall between roofs. */
  body: string
  /** Roof tile. */
  roof: string
  /** Eave trim, column and the finial. */
  trim: string
  /** Stone base. */
  plinth: string
  /** The lantern's own emissive colour — the tower's light source at night. */
  lantern: string
  /** Veranda deck and railing. */
  deck: string
  /** The underside of an eave — the roof tile in shadow. */
  soffit: string
  /** Ambient term. Cool at night, near-white by day. */
  ambient: string
  /** Frontal warm fill. */
  fill: string
  /** The sun, by day. */
  sun: string
}

/**
 * The landing pagoda. A sibling of `bonfirePalette`, deliberately outside
 * `ThemeTokens`: `components/three/**` is hex-free by rule, and this keeps it
 * that way without giving the vault-rules test an exception to make.
 *
 * The pagoda carries no data, so it uses brand sakura for its lit surfaces and
 * the site's own plum-ink neutrals for the rest. It never encodes gain or loss —
 * a roof tinted by "did this stock pass" would break the site's core rule.
 */
export const pagodaPalette: { dark: PagodaPalette; light: PagodaPalette } = {
  dark: {
    // Moonlit: plum-ink plaster under a deep sakura roof, with warm lanterns
    // doing the lighting. The trim is the brand hue because it is what the
    // lanterns catch.
    body: '#4C3A46',
    roof: '#8E4470',
    trim: '#FFA9C6',
    plinth: '#241A21',
    lantern: '#FFB877',
    deck: '#4A3641',
    soffit: '#2A1C25',
    ambient: '#5C6B93',
    fill: '#FFA9C6',
    sun: '#FFD9A8',
  },
  light: {
    // Petal Paper, in daylight: the same building, sunlit. Plaster reads warm
    // white, the tile keeps its sakura, and the sun is a touch above white so
    // the eaves throw a legible shadow.
    body: '#F5E7EC',
    roof: '#B0336A',
    trim: '#8C2753',
    plinth: '#E2CBD5',
    lantern: '#FFCE9A',
    deck: '#EAD6DE',
    soffit: '#C9A3B3',
    ambient: '#FFF4F8',
    fill: '#FFE7EF',
    sun: '#FFF3E2',
  },
}

export const CSS_VAR_BY_KEY: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  panel: '--panel',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border',
  input: '--input',
  ring: '--ring',
  gain: '--gain',
  loss: '--loss',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',
}

/** Renders the marked `index.css` block. Consumed by `tokens.sync.test.ts`. */
export function renderTokenBlock(lightTokens: ThemeTokens, darkTokens: ThemeTokens): string {
  const block = (selector: string, tokens: ThemeTokens) => {
    const vars = (Object.keys(CSS_VAR_BY_KEY) as Array<keyof ThemeTokens>)
      .map((key) => `  ${CSS_VAR_BY_KEY[key]}: ${tokens[key]};`)
      .join('\n')
    return `${selector} {\n${vars}\n}`
  }

  return [
    '/* @vault-tokens:start */',
    block(':root', lightTokens),
    '',
    block('.dark', darkTokens),
    '/* @vault-tokens:end */',
  ].join('\n')
}
