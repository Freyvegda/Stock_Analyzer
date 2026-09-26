# Sakura Vault v3 — Site-wide Sakura Theme and Liquid-Glass Navbar

**Date:** 2026-09-27
**Status:** Approved in principle by the owner ("perfect start building"); this document
records the exact decisions so `frontend/DESIGN.md` and the code can be updated from it.
**Supersedes parts of:** `2026-09-26-theme-v2-phosphor-vault-design.md` (palette identity and
the "sakura pink is scene-only" rule). The v2 loader/motion/token architecture is kept.

> **Update 2026-09-27 (after `60cbec0`):** the login session already shipped `sakuraScale`
> (exact values below), the Chakra `colors.sakura` palette with `colorPalette="sakura"` at every
> call site, a new `panel` surface token, and its own tuned `scenePalette`. This spec keeps all
> of that. Remaining scope: the `ThemeTokens` value swap (including `panel`), `chartPalette`,
> shell retints, the glass navbar, and the docs.

## Goal

Make the sakura identity the site-wide design language, in both dark and light mode, and
replace the flat top nav with a liquid-glass 3D capsule navbar. The login tree/petal scene
stays the only tree/leaf visual; the shell keeps its ambient particle field, re-tinted.

## Non-goals

- No second selectable palette (Phosphor Vault is retired, not kept side-by-side).
- No new dependencies. No changes to auth, API, pipeline behaviour, or backend.
- No tree/leaves/petals outside `/login` (`SakuraScene` remains login-only).
- The theme toggle UX is unchanged: same sun/moon/monitor menu, same View Transition wipe.
- Gain/loss polarity stays green/red + sign/arrow. Sakura never encodes polarity.

## Palette — "Sakura Vault v3"

All values are designed against the existing gates: `contrast.test.ts` (text ≥ 4.5:1,
graphics ≥ 3:1), dark surfaces luminance < 0.02 and blue − red ≤ 8 (`vault-rules.test.ts`).
The candidate values below pass all of them; verified with the gate pairs before approval.

### Dark — "Moonlit Sakura" (plum-ink, not blue-black)

| Role | Value | Role | Value |
|---|---|---|---|
| background | `#0C080B` | foreground | `#F2EAF0` |
| card | `#140F13` | card-foreground | `#F2EAF0` |
| panel (floating overlay) | `#201821` | panel-foreground | `#F2EAF0` |
| popover | `#201821` | popover-foreground | `#F2EAF0` |
| secondary | `#1A1219` | secondary-foreground | `#F2EAF0` |
| muted | `#120D11` | muted-foreground | `#A4939E` |
| accent | `#1A1219` | accent-foreground | `#F2EAF0` |
| border | `#2C2129` | input | `#2C2129` |
| primary | `#FFA9C6` | primary-foreground | `#2B0D1A` |
| ring | `#FFA9C6` | destructive | `#FF6B7A` |
| gain | `#3DD68C` | loss | `#FF6B7A` |
| chart1 | `#FFA9C6` | chart2 | `#8FB8D8` |
| chart3 | `#3DD68C` | chart4 | `#FF6B7A` |
| chart5 | `#9A8B96` | | |

Sidebar tokens mirror the old convention: sidebar `#140F13`, foreground `#F2EAF0`,
primary `#FFA9C6`, primary-foreground `#2B0D1A`, accent `#1A1219`, accent-foreground
`#F2EAF0`, border `#2C2129`, ring `#FFA9C6`.

### Light — "Petal Paper" (blush-white)

| Role | Value | Role | Value |
|---|---|---|---|
| background | `#FBF6F8` | foreground | `#1A1116` |
| card | `#FFFFFF` | card-foreground | `#1A1116` |
| panel (floating overlay) | `#FDF2F6` | panel-foreground | `#1A1116` |
| popover | `#FFFFFF` | popover-foreground | `#1A1116` |
| secondary | `#F3E7EC` | secondary-foreground | `#1A1116` |
| muted | `#F5EDF0` | muted-foreground | `#6E5F68` |
| accent | `#F3E7EC` | accent-foreground | `#1A1116` |
| border | `#E7D8DF` | input | `#DCC9D2` |
| primary | `#B0336A` | primary-foreground | `#FFF6FA` |
| ring | `#B0336A` | destructive | `#B91C1C` |
| gain | `#15803D` | loss | `#B91C1C` |
| chart1 | `#B0336A` | chart2 | `#4C6E8F` |
| chart3 | `#15803D` | chart4 | `#B91C1C` |
| chart5 | `#7A6A73` | | |

Sidebar: sidebar `#FFFFFF`, foreground `#1A1116`, primary `#B0336A`, primary-foreground
`#FFF6FA`, accent `#F3E7EC`, accent-foreground `#1A1116`, border `#E7D8DF`, ring `#B0336A`.

### Sakura scale

Already shipped in `60cbec0`: `sakuraScale` is the Chakra `colors.sakura.*` palette
(`colorPalette="sakura"`), and every call site already uses it. No component ever writes a raw
palette utility; semantic tokens only.

| Step | Value | Step | Value |
|---|---|---|---|
| 50 | `#FFF5F8` | 500 | `#F472A5` |
| 100 | `#FFE7EF` | 600 | `#DB4E8A` |
| 200 | `#FFC9DD` | 700 | `#B0336A` |
| 300 | `#FFA9C6` | 800 | `#8C2753` |
| 400 | `#FF8FB5` | 900 | `#6B1D40` |
| | | 950 | `#4A1029` |

Dark primary = 300; light primary = 700 (mirrors the v2 amber.400/amber.700 duty).
The Chakra virtual tokens (`contrast`, `fg`, `subtle`, `muted`, `emphasized`, `solid`,
`focusRing`, `border`) are redefined for `sakura` from these steps, preserving the v2
tint strengths (`subtle` dark = `rgba(255, 169, 198, 0.12)`, `muted` dark = 0.20,
`emphasized` dark = 0.32).

### Chart palette

`chartPalette` keeps its shape; values follow the table above. Crosshair:
dark `rgba(255, 169, 198, 0.5)`, light `rgba(176, 51, 106, 0.5)`. Grid lines unchanged.

### Login scene

`scenePalette` stays exactly as shipped in `60cbec0` (its tuning was just validated by the
scene tests and the owner's review; the earlier sky-harmonisation tweak is dropped). It remains
login-only and outside `ThemeTokens`. Petal-vs-sky contrast stays ≥ 3:1
(`scene-palette.test.ts`).

## Liquid-glass 3D navbar

New `frontend/src/components/GlassNav.tsx` replaces the inline `<nav>` in `App.tsx`.
The `StatusRail` stays directly below it; `<main className="p-6">` unchanged.

**Structure.** Sticky wrapper (`sticky top-0 z-30`, side/top gutter), inner capsule
(`rounded-2xl`), containing: brand (TrendingUp icon + `STOCK ANALYZER`), three route links,
then right side: username (hidden below `sm`), logout `IconButton`, `ThemeToggle`.

**Glass recipe (token-derived, no hex).** Class `.glass-nav` in `index.css`:
- background: vertical `linear-gradient` of `color-mix(in oklab, var(--card) 72%, transparent)`
  over `color-mix(in oklab, var(--background) 58%, transparent)`;
- border: `1px solid color-mix(in oklab, var(--border) 80%, transparent)`;
- `backdrop-filter: blur(14px) saturate(1.35)`;
- shadows: inset top highlight `color-mix(in oklab, var(--foreground) 9%, transparent)` plus
  soft drop `0 16px 40px -24px` in a background-mixed tone. This is the one sanctioned
  overlay shadow surface (recorded in DESIGN.md).

**3D tilt.** Only when `(pointer: fine)` and motion is not reduced: the capsule tracks the
pointer with `motion` springs (`useMotionValue` + `useSpring`, stiffness 260, damping 30)
up to ±3° `rotateX`/`rotateY` with `perspective: 900px`; resets on leave. The capsule carries
`data-tilt="on|off"` for tests.

**Specular sheen.** A `::after` radial gradient in `color-mix(in oklab, var(--primary) 14%, transparent)`
positioned by `--sheen-x`/`--sheen-y` custom properties updated on pointer move (no React
re-render); fades in on hover via `--sheen-opacity` (200ms `--ease-vault`). Disabled under
reduced motion.

**Active link pill.** Replaces the v2 underline: a spring `layoutId="nav-active-pill"` span
behind the active `NavLink`, styled by `.glass-nav-pill` (primary tint 12% + 1px primary
border 30% + soft glow). Under reduced motion it renders as a static span (no `layoutId`
motion). Inactive links: `text-muted-foreground`, hover `text-foreground`.

**Entrance.** One-shot 320ms fade + 8px rise + 6px blur clear, `--ease-vault`; instant under
reduced motion. No loop is added: the loop whitelist is unchanged.

**Mobile.** Capsule keeps glass; nav row wraps rather than overflowing; username hidden below
`sm`; tilt/sheen off for coarse pointers.

**Accessibility.** `<nav aria-label="Primary">`; pills are decorative (`aria-hidden`); links
carry `aria-current` via `NavLink`; focus ring unchanged (`:focus-visible` base layer);
logout keeps its `aria-label`; all icons `strokeWidth={1.75}`, decorative icons `aria-hidden`.

## Background & surface coverage (both modes)

The palette swap flows through CSS variables automatically; the audit list of places that
carry an explicit tint and must be retinted in the same change:

1. `index.css` `.vault-backdrop`: dark glow `rgba(255, 180, 84, 0.06)` →
   `rgba(255, 169, 198, 0.05)`; light grain `rgba(180, 83, 9, 0.05)` →
   `rgba(176, 51, 106, 0.045)`.
2. `index.css` `[data-flash='neutral']`: `rgba(255, 180, 84, 0.18)` → `rgba(255, 169, 198, 0.18)`.
3. `index.css` `.vault-pulse` (no-WebGL loader fallback ring): amber rgba → sakura rgba
   (`rgba(255, 169, 198, 0.08)` ring, `0.25` inset).
4. `AmbientField` particles read `paletteFor(mode).primary` — retints automatically; comments
   only.
5. `MarketRingLoader` reads its primary/highlight from the same palette — automatic; comments
   only.
6. `SakuraScene` — scene palette tweak only (above).
7. Stale wording: `Backdrop.tsx` and any "amber" comments; `DESIGN.md` + `FRONTEND.md`.

Everything else already uses semantic tokens (`bg-background`, `bg-card`, `bg.panel`,
`fg.muted`, `border-border`, `chartPalette`), so no component-level colour edits are needed.
The 5 `colorPalette="amber"` call sites (`CriteriaPanel.tsx` ×2, `CriteriaDialog.tsx`,
`Fundamentals.tsx`, `Login.tsx`) already became `colorPalette="sakura"` in `60cbec0`; verify
only.

## Gates and documentation

- `tokens.sync.test.ts`: regenerate the `index.css` block with
  `$env:VAULT_SYNC='1'; npm run tokens:sync`.
- `contrast.test.ts` (now also gating `foreground/panel` and `muted-foreground/panel`),
  `vault-rules.test.ts`, `scene-palette.test.ts`: keep green; no rule weakening is expected
  (values were chosen against them).
- `system.test.ts`: already asserts the `sakura` scale, virtual tokens, and `bg.panel`
  (shipped in `60cbec0`); no change needed.
- New `GlassNav.test.tsx`: active link `aria-current` + exactly one pill inside it; `data-tilt="off"`
  under reduced motion (jsdom's `matchMedia` reports no fine pointer); logout + theme toggle
  present; nav landmark labelled.
- `frontend/DESIGN.md`: replace the phosphor palette table with the sakura tables, replace the
  nav/active-underline rule with the pill rule, add the glass surface exception, update the
  Sakura Garden section (tree still login-only; pink is no longer scene-only), update loop
  whitelist wording (unchanged membership).
- `frontend/FRONTEND.md`: theming bullet and structure listing updated.
- `npm run test` and `npm run build` green; `graphify update .` after code changes.

## Review focus (failure modes to pin in tests)

1. Reduced motion: navbar must be static — no tilt, no sheen, no moving pill.
2. Coarse pointer (touch): tilt and sheen off.
3. Charts and flash tints still readable in both modes after retint.
4. Dark surfaces must not drift blue (blue − red ≤ 8) or brighten above 0.02 luminance.
5. `colorPalette="sakura"` must resolve in Chakra (virtual tokens defined, no fallback to a
   default palette).
