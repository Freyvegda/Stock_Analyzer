# Phase 1 Frontend — Hybrid shadcn + Chakra UI with Light/Dark Theming

**Date:** 2026-09-26
**Status:** Approved (design Rev 2: design system + motion + 3D)
**Scope:** `frontend/` only. Phase 1 (Fundamentals page + app shell).

## Intent

The Phase-1 Fundamentals page must be a polished, usable screen: view criteria, run the
screener, see a ranked shortlist — in both light and dark mode. The UI is built from two
libraries: shadcn/ui + Tailwind (already in the repo) and Chakra UI v3 (new), following the
user-approved hybrid strategy:

> Keep Tailwind + shadcn as the base for layout and dense data display. Add Chakra v3 for
> interactive/status components and theming, sharing one `.dark` class so a single theme
> toggle drives both systems.

Success criteria:

- Screen run loop works end-to-end with loading, error, and empty states.
- Theme toggle (Light / Dark / System) persists across reloads; both modes fully styled.
- All frontend Phase-1 review findings fixed (broken reload endpoint, missing tests,
  dark theme never activated, fresh-run metadata missing, silent failures).
- `npm run build` clean and `npm run test` green.

## Constraints

- `frontend/FRONTEND.md`: dense, tabular tool aesthetic; not a marketing site.
- Phase 1 only: the shell and `Fundamentals` page are in scope; `Documents` and `Backtest`
  stay placeholder pages until phases 2–4.
- Backend API contract is unchanged. `POST /screen/run` still returns
  `{run_id, shortlisted, failed_count, total}`; enriched rows (name/sector/market_cap) come
  from `GET /screen/latest`.
- Tests run offline (mock `fetch`); no network in vitest.
- No global state store; local `useState` is sufficient.

## Decisions

1. **Chakra setup:** install `@chakra-ui/react` and `@emotion/react`; generate snippets with
   `npx @chakra-ui/cli snippet add` (provider, toaster, tooltip, color-mode). Create the
   system with `createSystem(defaultConfig, { preflight: false })` so Tailwind's Preflight
   remains the only CSS reset.
2. **Color mode:** next-themes (installed by the Chakra CLI) with
   `attribute="class"`, `storageKey="stock-analyzer-theme"`, `defaultTheme="system"`,
   `enableSystem`, `disableTransitionOnChange`. This puts `dark`/`light` on `<html>`, which
   Tailwind's `@custom-variant dark (&:is(.dark *))` (index.css:6) already understands.
3. **No flash on load:** add a small inline script in `index.html` that reads the persisted
   theme (or `prefers-color-scheme`) and sets the initial `dark` class before the app bundle
   runs.
4. **Theme toggle:** Chakra `Menu` + `IconButton` in the app header with Light / Dark /
   System items (lucide icons). Current selection marked.
5. **Component split:** Chakra owns provider, theme, toggle, toaster, loading button,
   criteria panel. shadcn/Tailwind owns shell layout, cards, and `ShortlistTable`.
6. **Run button:** Chakra `Button` with `loading` / `loadingText`
   ("Fetching fundamentals for ~500 stocks — takes a few minutes").
7. **Fresh-run enrichment:** after a successful `POST /screen/run`, immediately re-fetch
   `GET /screen/latest` and render its rows, so Name / Sector / Mkt Cap are populated
   without a page reload.
8. **Reload config:** the panel's reload button calls `POST /screen/config/reload`
   (currently it calls the cached `GET /screen/config`, so edits never appear) and refreshes
   the panel; failures surface as an error message + toast.
9. **Error handling:** `api/client.ts` parses the backend's `{"detail": ...}` error body into
   a typed error; every mount-time and action-time request has a catch that surfaces an
   inline message and/or toast. No more silent failures.
10. **Testing:** add `vitest`, `jsdom`, `@testing-library/react`; `npm run test` =
    `vitest run`. Tests: `sortRows` (numeric asc/desc, nulls last in both directions,
    direction toggle), `CriteriaPanel` render + reload callback, `ShortlistTable` D/E badge
    threshold and null rendering.

## Architecture

```
src/
├── main.tsx                     # wraps App in <Provider> (Chakra + next-themes)
├── App.tsx                      # shell: semantic tokens (bg-background/text-foreground), header + ThemeToggle
├── theme/
│   └── system.ts                # createSystem(defaultConfig, { preflight: false, theme: {...} })
├── components/
│   ├── ui/                      # shadcn components + Chakra snippets (provider, color-mode, toaster, tooltip)
│   ├── ThemeToggle.tsx          # Chakra Menu: Light / Dark / System
│   ├── CriteriaPanel.tsx        # Chakra Stack + Badge + Button (reload)
│   ├── ShortlistTable.tsx       # shadcn Table, sortable, aria-sort, D/E badge
│   └── __tests__/               # component tests
├── pages/
│   └── Fundamentals.tsx         # state + run loop
├── lib/
│   ├── sort.ts                  # sortRows (existing; unchanged contract)
│   └── sort.test.ts             # NEW
└── api/
    ├── client.ts                # detail-aware error handling
    └── types.ts                 # unchanged contract
```

### Data flow

1. Mount: `GET /screen/config` + `GET /screen/latest` (both caught). Latest run renders
   immediately if it exists; empty state otherwise.
2. Run: `POST /screen/run` → re-fetch `GET /screen/latest` → summary line
   `X shortlisted · Y failed · Z total` + table.
3. Reload: `POST /screen/config/reload` → panel refreshes from the response.
4. Errors anywhere render an inline message (page-level alert for run/latest failures,
   panel-level for config failures) and a Chakra toast for action failures.

## Component specs

### ThemeToggle

- Chakra `Menu.Root` + `IconButton` trigger (`aria-label="Color mode"`, lucide
  `Sun`/`Moon` icons reflecting current mode).
- Items: Light, Dark, System; selected item checked; `System` uses next-themes resolved
  system preference.
- Persistence is next-themes' localStorage key `stock-analyzer-theme`.

### CriteriaPanel

- Props: `config: ScreenConfig | null`, `onReload: () => void`, `reloading: boolean`,
  `error: string | null`.
- Renders each criterion as a read-only Chakra `Badge` (`PE ≤ 25`, `ROE ≥ 15%`, …), with a
  human label map for all six engine keys and a generic fallback for unknown keys.
- Hint text: "Edit `backend/config/screening.yaml`"; reload `Button` with `loading`.
- Panel-level error text when a config load/reload fails.

### ShortlistTable

- shadcn `Table`; columns in order: Rank, Symbol, Name, Sector, PE, PB, ROE%, ROCE%, D/E,
  Mkt Cap (cr), Score.
- Client-side sorting via `sortRows(rows, key, dir)` (`src/lib/sort.ts`); header click
  toggles asc/desc. Headers are real buttons with `aria-sort`; keyboard operable.
- Numeric cells right-aligned, 1 decimal, `—` for null; D/E shows a destructive badge when
  > 0.3 even for passed stocks.
- Rank and Score use the same numeric formatting rules.

### Fundamentals page

- State: `config`, `rows`, `summary {shortlisted, failed, total}`, `loadingRun`,
  `loadingInitial`, `error`.
- Run button (Chakra) shows loading text while in flight; disabled meanwhile.
- Empty state: "No stocks passed the screen" when a run returned zero rows.
- Summary line exact format: `X shortlisted · Y failed · Z total`.
- Page-level error alert for failed run/latest fetches.

## Theming details

- `index.css` tokens stay the single source for shadcn colors; light values in `:root`,
  dark values in `.dark` (already present, index.css:51-118).
- Shell stops hardcoding `bg-zinc-950 text-zinc-100` (App.tsx:14) and uses semantic tokens
  (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`) so both
  modes are correct; Chakra components use Chakra semantic tokens (`bg.subtle`,
  `fg.muted`, `border.subtle`).
- `index.html` gets the no-flash inline script (see Decisions #3).

## Testing

| Test | File | Covers |
|---|---|---|
| `sortRows` | `src/lib/sort.test.ts` | numeric asc/desc, nulls last both directions, toggle |
| CriteriaPanel | `src/components/__tests__/CriteriaPanel.test.tsx` | renders config entries, hint text, reload callback + loading state |
| ShortlistTable | `src/components/__tests__/ShortlistTable.test.tsx` | D/E badge > 0.3 vs ≤ 0.3, null → `—`, header click toggles sort |

- Setup: `jsdom` environment, RTL cleanup, `fetch` mocked/stubbed in tests.
- Commands: `npm run test` (CI-style, `vitest run`), `npm run build` must stay clean.

## Documentation updates

- `frontend/FRONTEND.md`: stack section gains Chakra UI v3 (hybrid rules: Chakra =
  interactive/status, shadcn/Tailwind = shell + tables), theming section (next-themes,
  one `.dark` class), test command.
- `plan/phase-1-fundamental-screen/frontend.md`: reload uses
  `POST /screen/config/reload`; after a run, rows come from `GET /screen/latest`
  (enriched with Name/Sector/Mkt Cap); vitest tests required.
- No backend or database changes in this task.

## Out of scope

- `Documents` / `Backtest` page content (phases 2–4).
- Charts (`lightweight-charts`, `recharts`) work (phase 3).
- Backend review findings (notably `backend/app/data/` being gitignored) — separate task.
- Server-side theme persistence; localStorage is sufficient for a single-user local tool.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tailwind and Chakra cascade layers/reset conflict | `preflight: false`; if conflicts appear, pin explicit `@layer` order in `index.css`; verify both modes visually |
| Bundle size grows with Chakra + Emotion | Local single-user tool; acceptable; no code-splitting required |
| Theme flash before JS runs | Inline script in `index.html` sets initial class |
| Chakra CLI adds `react-icons` (project uses lucide) | Replace snippet icons with lucide; avoid duplicate icon dependency |
| Snippet files land in `src/components/ui/` next to shadcn files | Acceptable; names (`provider`, `color-mode`, `toaster`, `tooltip`) do not collide |

## Acceptance checklist

- [ ] `npm run build` clean; `npm run test` green.
- [ ] Theme toggle switches Chakra and shadcn surfaces together; choice persists; system
      default on first visit; no flash on reload.
- [ ] Light and dark modes both fully styled (no dark-only hardcoded colors).
- [ ] Run loop: click Run → loading text → summary line → table with Name/Sector/Mkt Cap.
- [ ] Reload config button actually reloads `screening.yaml` (verify by editing a threshold).
- [ ] Failed requests show inline errors (config panel and page level), never silent.
- [ ] Zero stock shortlist shows the empty state.
- [ ] Vitest covers `sortRows`, `CriteriaPanel`, `ShortlistTable` per table above.

---

# Revision 2 — Design system, motion, Three.js (approved 2026-09-26)

Extends the approved design above. The interview the user answered: 3D = ambient shell +
run-loading only; design direction = Terminal emerald; icons = lucide-react only.

## Additions

### A. Design set — `frontend/DESIGN.md` (source of truth)

A new doc every frontend change follows; `FRONTEND.md` links to it. Contents:

- **Palette (Terminal emerald):** zinc neutrals; emerald primary; red destructive;
  emerald = gain, red = loss; emerald focus ring; emerald chart-1. Values live in two
  synced places — Chakra `theme.tokens` (`src/theme/system.ts`) and the shadcn/Tailwind
  CSS vars (`src/index.css` `:root` / `.dark`) — with DESIGN.md's table as the contract.
  Pinned values:
  - Light: `--primary: oklch(0.596 0.145 163.225)`, `--primary-foreground: oklch(0.985 0 0)`,
    `--ring: oklch(0.596 0.145 163.225)`.
  - Dark: `--primary: oklch(0.696 0.17 162.48)`, `--primary-foreground: oklch(0.145 0 0)`,
    `--ring: oklch(0.696 0.17 162.48)`.
- **Type:** Geist Variable; numeric data uses `tabular-nums`; sizes xs 12 / sm 14 / base 16 /
  lg 18 / xl 20–24.
- **Shape/spacing:** radii 6/8/10; 1px hairline borders; elevation only on popovers, menus,
  toasts; 4px spacing grid.
- **Motion:** durations 150 (fast) / 220 (base) / 320 (entrance) ms; no continuous animation
  inside data areas; every animation honors `prefers-reduced-motion` (instant render).
- **Icons:** `lucide-react` only; 16px default (14px in dense table headers);
  `strokeWidth={1.75}`; decorative icons `aria-hidden="true"`; icon-only buttons carry
  `aria-label`; no `react-icons`.
- **3D rules:** decorative only, never blocks readability; lazy-loaded; hidden below `md`;
  paused when the tab is hidden; skipped for reduced-motion users; must degrade to a static
  fallback when WebGL is unavailable.
- **Light/dark parity:** both modes designed; no inverted-only colors; AA contrast.

### B. Motion components

Dependency: `motion` (v13, React 19 compatible). Magic UI patterns are hand-copied into
`src/components/ui/` and restyled to our tokens; no runtime dependency on Magic UI.

- `NumberTicker` — animated count-up for summary numbers (`X shortlisted · Y failed ·
  Z total`); instant final value under reduced motion.
- `BlurFade` — entrance for panels/table; staggered, capped delay.
- `BorderBeam` — animated border overlay for the run card while a screen is running;
  static or hidden under reduced motion.
- `DotPattern` — empty-state background.
- Shared hook `src/lib/usePrefersReducedMotion.ts` gates all of the above.

### C. Three.js

Dependencies: `three` + `@react-three/fiber` (no drei initially).

- `src/components/three/AmbientField.tsx` — shell-level ambient particle field: lazy
  (`React.lazy` + `Suspense`), fixed behind content, `pointer-events-none`, `aria-hidden`,
  low opacity, emerald tint, DPR capped at 1.5, pauses on `visibilitychange`, hidden below
  `md`, skipped under reduced motion.
- `src/components/three/RunVisual.tsx` — rotating wireframe cluster (~160px) shown inside
  the run-loading card.
- `src/lib/webgl.ts` `hasWebGL(): boolean` — safe WebGL probe; components render the
  fallback (nothing / `DotPattern`) when false or when reduced motion is preferred.
- 3D code loads only in an async chunk; the initial bundle must not include `three`
  (verified from `npm run build` output).

### D. Tests and docs

- Tests: `NumberTicker` final value + reduced-motion instant; `BlurFade`/`BorderBeam`
  reduced-motion render children; `hasWebGL` returns false in jsdom; `AmbientField` /
  `RunVisual` render the fallback without throwing when WebGL is unavailable.
- `DESIGN.md` created; `FRONTEND.md` links it and lists the motion/3D dependencies.

## Revised acceptance additions

- [ ] Both modes follow DESIGN.md; no hardcoded zinc in shell/screen components.
- [ ] All icons are lucide-react at the documented size/stroke.
- [ ] Motion components honor `prefers-reduced-motion` (no animation, correct content).
- [ ] 3D appears on the shell and during a run only; missing WebGL degrades gracefully;
      initial JS bundle excludes `three` (async chunk only).

