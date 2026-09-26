# Design Set — Stock Analyzer

Source of truth for the frontend's visual and motion language. Every frontend change follows
this document. If a value here changes, update both token files in the same change:
`frontend/src/index.css` (shadcn/Tailwind CSS vars) and `frontend/src/theme/system.ts`
(Chakra UI tokens).

## Palette — Terminal emerald

Zinc neutrals, emerald primary, red destructive. Emerald communicates gain/positive;
red communicates loss/destructive.

| Token | Light (`:root`) | Dark (`.dark`) | Use |
|---|---|---|---|
| `--primary` | `oklch(0.596 0.145 163.225)` | `oklch(0.696 0.17 162.48)` | primary actions, accents, focus ring |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.145 0 0)` | text on primary |
| `--ring` | `oklch(0.596 0.145 163.225)` | `oklch(0.696 0.17 162.48)` | focus rings |
| `--chart-1` | `oklch(0.596 0.145 163.225)` | `oklch(0.696 0.17 162.48)` | primary chart series |
| `--background` / `--foreground` | `oklch(1 0 0)` / `oklch(0.145 0 0)` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` | page surfaces and text |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | loss, errors, D/E warnings |

Chakra mirrors the accent as the semantic token `brand` (`emerald.600` light,
`emerald.500` dark) and defines the full Tailwind emerald scale as tokens in
`src/theme/system.ts`, including the virtual `emerald` color tokens that make
`colorPalette="emerald"` valid.

Rules:
- Never hardcode palette classes (`zinc-950`, `zinc-100`, `text-white`) in shell or screen
  components; use design tokens (`bg-background`, `text-foreground`, `border-border`,
  `text-muted-foreground`) or Chakra semantic tokens (`bg`, `fg.muted`, `border.subtle`,
  `brand`).
- Gain is emerald, loss is red. Do not introduce extra accent hues.

## Typography

- Family: Geist Variable (loaded via `@fontsource-variable/geist`).
- Sizes: 12 (xs) / 14 (sm) / 16 (base) / 18 (lg) / 20–24 (xl, page headings).
- Numeric data (ratios, prices, scores, counts) always uses `tabular-nums` so columns align.

## Shape and spacing

- Radii: 6 (sm) / 8 (md) / 10 (lg); cards and overlays use lg.
- Borders: 1px hairlines; the border token carries the color.
- Spacing: 4px grid.
- Elevation: only on overlays (popovers, menus, toasts); the page itself is flat.

## Motion

- Durations: 150 ms (fast feedback) / 220 ms (base) / 320 ms (entrance).
- No continuous or looping animation inside data areas (tables, ratios, summaries).
- Exception: `StairTowerLoader` (`src/components/ui/StairTowerLoader.tsx` + `stair-tower.css`) is the
  single sanctioned continuous/looping animation. It renders in control surfaces only — the run
  card (~120px) and login/save buttons (~20px) — never inside data areas.
- Honoring `prefers-reduced-motion: reduce` is mandatory: animations render their final
  state instantly, or do not run at all. Use `usePrefersReducedMotion`.

## Icons

- Library: `lucide-react` only. `react-icons` is not allowed.
- Sizes: 16px default; 14px inside dense table headers.
- Stroke: `strokeWidth={1.75}` for consistency; do not mix weights.
- Decorative icons: `aria-hidden="true"`. Icon-only buttons: always `aria-label`.

## 3D

- Decorative only — it must never obscure or compete with data.
- Lazy-loaded (async chunk), never in the initial bundle.
- Hidden below `md`; paused while the tab is hidden; skipped under reduced motion.
- Requires `hasWebGL()`; otherwise render the static fallback. A missing WebGL context is
  not an error state the user sees.

## Light/dark parity

- Both modes are designed, not inverted copies; check contrast in both.
- Target WCAG AA for text and interactive elements in both modes.
