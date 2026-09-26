/**
 * Single source of truth for the Phosphor Vault palette (see DESIGN.md).
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
  background: '#050607',
  foreground: '#E9EDF6',
  card: '#0C0E12',
  cardForeground: '#E9EDF6',
  panel: '#1A1D22',
  popover: '#1A1D22',
  popoverForeground: '#E9EDF6',
  primary: '#FFB454',
  primaryForeground: '#201403',
  secondary: '#14171C',
  secondaryForeground: '#E9EDF6',
  muted: '#101216',
  mutedForeground: '#868C9A',
  accent: '#14171C',
  accentForeground: '#E9EDF6',
  destructive: '#FF6B6E',
  border: '#23262E',
  input: '#23262E',
  ring: '#FFB454',
  gain: '#3DD68C',
  loss: '#FF6B6E',
  chart1: '#FFB454',
  chart2: '#6FB7D9',
  chart3: '#3DD68C',
  chart4: '#FF6B6E',
  chart5: '#8891A8',
  sidebar: '#0C0E12',
  sidebarForeground: '#E9EDF6',
  sidebarPrimary: '#FFB454',
  sidebarPrimaryForeground: '#201403',
  sidebarAccent: '#14171C',
  sidebarAccentForeground: '#E9EDF6',
  sidebarBorder: '#23262E',
  sidebarRing: '#FFB454',
}

export const light: ThemeTokens = {
  background: '#F6F4EF',
  foreground: '#14181F',
  card: '#FFFFFF',
  cardForeground: '#14181F',
  panel: '#FBF6EE',
  popover: '#FFFFFF',
  popoverForeground: '#14181F',
  primary: '#B45309',
  primaryForeground: '#FFF8EC',
  secondary: '#EAE5DB',
  secondaryForeground: '#14181F',
  muted: '#EFEBE3',
  mutedForeground: '#6E6A62',
  accent: '#EFEBE3',
  accentForeground: '#14181F',
  destructive: '#B91C1C',
  border: '#E3DDD2',
  input: '#D9D2C4',
  ring: '#B45309',
  gain: '#15803D',
  loss: '#B91C1C',
  chart1: '#B45309',
  chart2: '#3E6B8C',
  chart3: '#15803D',
  chart4: '#B91C1C',
  chart5: '#6E6A62',
  sidebar: '#FFFFFF',
  sidebarForeground: '#14181F',
  sidebarPrimary: '#B45309',
  sidebarPrimaryForeground: '#FFF8EC',
  sidebarAccent: '#EFEBE3',
  sidebarAccentForeground: '#14181F',
  sidebarBorder: '#E3DDD2',
  sidebarRing: '#B45309',
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
    crosshair: 'rgba(255, 180, 84, 0.5)',
    candleUp: dark.gain,
    candleDown: dark.loss,
    strategy: dark.primary,
    benchmark: dark.chart2,
  },
  light: {
    grid: 'rgba(20, 24, 31, 0.06)',
    crosshair: 'rgba(180, 83, 9, 0.5)',
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
