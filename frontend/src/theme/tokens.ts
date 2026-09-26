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
  background: '#0A0E1A',
  foreground: '#E9EDF6',
  card: '#111828',
  cardForeground: '#E9EDF6',
  popover: '#1F2A42',
  popoverForeground: '#E9EDF6',
  primary: '#FFB454',
  primaryForeground: '#201403',
  secondary: '#182136',
  secondaryForeground: '#E9EDF6',
  muted: '#141D31',
  mutedForeground: '#8891A8',
  accent: '#182136',
  accentForeground: '#E9EDF6',
  destructive: '#FF6B6E',
  border: '#232C45',
  input: '#232C45',
  ring: '#FFB454',
  gain: '#3DD68C',
  loss: '#FF6B6E',
  chart1: '#FFB454',
  chart2: '#6FB7D9',
  chart3: '#3DD68C',
  chart4: '#FF6B6E',
  chart5: '#8891A8',
  sidebar: '#111828',
  sidebarForeground: '#E9EDF6',
  sidebarPrimary: '#FFB454',
  sidebarPrimaryForeground: '#201403',
  sidebarAccent: '#182136',
  sidebarAccentForeground: '#E9EDF6',
  sidebarBorder: '#232C45',
  sidebarRing: '#FFB454',
}

export const light: ThemeTokens = {
  background: '#F6F4EF',
  foreground: '#14181F',
  card: '#FFFFFF',
  cardForeground: '#14181F',
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

/** Custom amber scale (Chakra `colors.amber.*` + Tailwind `amber-*` utilities). */
export const amberScale: Record<number, string> = {
  50: '#FFF9ED',
  100: '#FEF0D6',
  200: '#FCE0AE',
  300: '#F9C87B',
  400: '#FFB454',
  500: '#EE9A2F',
  600: '#D97706',
  700: '#B45309',
  800: '#92400E',
  900: '#78350F',
  950: '#451A03',
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

export const CSS_VAR_BY_KEY: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
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
