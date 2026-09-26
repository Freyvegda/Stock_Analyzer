# Phase 1 Frontend — Hybrid shadcn + Chakra UI, Terminal-Emerald Design Set, Motion + 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Phase-1 Fundamentals UI with Chakra UI v3 alongside the existing shadcn/Tailwind base, follow a documented Terminal-emerald design set, add a persisted Light/Dark/System theme toggle, tasteful Motion animations, and lazy-loaded Three.js ambience, and fix the Phase-1 frontend review findings.

**Architecture:** One next-themes `attribute="class"` provider puts `dark`/`light` on `<html>`; Tailwind's `@custom-variant dark (&:is(.dark *))` and Chakra semantic tokens both key off that single class, so one toggle drives both systems. Design tokens live in two synced files (`index.css` for shadcn/Tailwind, `src/theme/system.ts` for Chakra) with `frontend/DESIGN.md` as the contract. Chakra owns provider, theming, toggle, toasts, criteria panel, status controls; shadcn + Tailwind own the shell, cards, and dense `ShortlistTable`. Motion and 3D are decorations behind `prefers-reduced-motion` and WebGL capability gates, and never block data readability.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind v4, shadcn/ui, Chakra UI v3 (+ @emotion/react, next-themes), motion v13, three + @react-three/fiber, lucide-react, vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-26-phase-1-frontend-chakra-theming-design.md`

## Global Constraints

- Working dir for all commands: `frontend/` (e.g. `D:\CODES\Projects\stock-analyzer\frontend`).
- `npm run build` (`tsc -b && vite build`) must stay clean after every task.
- Tests run offline; mock `fetch`, the `api` module, or the WebGL probe. Never hit the network.
- `tsconfig.app.json` sets `verbatimModuleSyntax` and `erasableSyntaxOnly`: use `import type { ... }` for types, and never use TS parameter properties (`constructor(public x: T)`) or enums; assign class fields explicitly.
- `tsconfig.app.json` sets `noUnusedLocals` / `noUnusedParameters`: no dead imports or variables (test files included).
- Chakra reset stays off: `createSystem(defaultConfig, { preflight: false })`; Tailwind Preflight is the only reset.
- `next-themes` config is exactly: `attribute="class"`, `storageKey="stock-analyzer-theme"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- Hybrid split is binding: Chakra = provider/theme/toggle/toast/criteria panel/status controls; shadcn + Tailwind = shell, cards, `ShortlistTable`.
- `frontend/DESIGN.md` is the design contract: Terminal emerald palette, Geist type, `tabular-nums` on numeric data, radii 6/8/10, motion durations 150/220/320 ms, lucide-only icons (16px default, 14px in dense table headers, `strokeWidth={1.75}`, `aria-hidden` when decorative, `aria-label` on icon-only buttons).
- No `react-icons`; the only icon library is `lucide-react`.
- Every animation and 3D effect honors `prefers-reduced-motion` and degrades to static content; 3D additionally requires `hasWebGL()`.
- Three.js code must stay in an async chunk; the initial bundle must not include `three`.
- No global state store, no runtime dependency on Magic UI components (patterns are copied and restyled).
- Summary line format is exactly: `` `${shortlisted} shortlisted · ${failed} failed · ${total} total` ``.
- Dates/values/API shapes come from `src/api/types.ts`; do not change the types.
- Test files: `src/lib/sort.test.ts`, `src/lib/webgl.test.ts`, `src/api/__tests__/client.test.ts`, `src/components/__tests__/{ThemeToggle,CriteriaPanel,ShortlistTable,NumberTicker,BlurFade,BorderBeam,DotPattern}.test.tsx`, `src/components/three/__tests__/{AmbientField,RunVisual}.test.tsx`, `src/pages/__tests__/Fundamentals.test.tsx`.

## Review Focus

The spec implies these inputs; each has the named test in the owning task.

1. Persisted theme missing, `"system"`, or corrupt (`localStorage` garbage) on first load → page renders without crashing and follows system preference. Test: ThemeToggle "renders with corrupt persisted theme".
2. Backend unreachable at mount → page shows an inline error instead of a blank screen or unhandled rejection. Test: Fundamentals "shows an error when initial loads fail".
3. Run completes with zero shortlisted rows → empty state "No stocks passed the screen", summary still rendered. Test: Fundamentals "shows empty state for a zero-row run".
4. Malformed config payload (unknown criterion keys, empty criteria) → panel renders fallback labels, never crashes. Test: CriteriaPanel "renders unknown keys with fallback label".
5. Rows with all-null ratios / missing name / sector / market cap → cells show `—`, nulls stay last when sorting, D/E badge never renders for null. Tests: ShortlistTable "renders placeholders for missing values", "does not badge a null D/E".
6. Reduced-motion user system-wide → motion components render final content instantly; 3D renders its fallback. Tests: NumberTicker/BlurFade/BorderBeam reduced-motion tests, AmbientField/RunVisual fallback tests.
7. WebGL unavailable/blocked → ambient and run visuals render fallback, never throw. Tests: `hasWebGL` (jsdom), AmbientField/RunVisual with mocked probe false.

Manual-only checks (Task 9): tab-hidden pause of the 3D field; 3D hidden below `md`; scene visually low-key in both themes.

---

### Task 1: Vitest infrastructure + `sortRows` characterization tests

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/lib/sort.test.ts`
- Modify: `frontend/package.json` (scripts + devDependencies)
- Modify: `frontend/tsconfig.node.json` (include `vitest.config.ts`)

**Interfaces:**
- Consumes: `sortRows(rows, key, dir)` and `SortDir` from `src/lib/sort.ts` (exists; do not change its behavior).
- Produces: `npm run test` = `vitest run`; jsdom environment with `src/test/setup.ts` (RTL cleanup + `matchMedia` stub); alias `@/` working in tests. Every later task uses these.

- [ ] **Step 1: Install dev dependencies**

```powershell
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Create `frontend/vitest.config.ts`**

```ts
import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

- [ ] **Step 3: Create `frontend/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => cleanup())

// jsdom has no matchMedia; next-themes, Chakra, and usePrefersReducedMotion read it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
```

- [ ] **Step 4: Add the test script to `frontend/package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "oxlint",
  "test": "vitest run",
  "preview": "vite preview"
}
```

- [ ] **Step 5: Add `vitest.config.ts` to `frontend/tsconfig.node.json` include**

```json
"include": ["vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 6: Write `frontend/src/lib/sort.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { sortRows, type SortDir } from './sort'

type Row = { symbol: string; score: number | null }
const rows: Row[] = [
  { symbol: 'C', score: null },
  { symbol: 'A', score: 2 },
  { symbol: 'B', score: 10 },
]

describe('sortRows', () => {
  it('sorts numbers ascending and descending', () => {
    expect(sortRows(rows, 'score', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(sortRows(rows, 'score', 'desc').map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
  })

  it('keeps nulls last in both directions', () => {
    const asc = sortRows(rows, 'score', 'asc')
    const desc = sortRows(rows, 'score', 'desc')
    expect(asc[asc.length - 1].score).toBeNull()
    expect(desc[desc.length - 1].score).toBeNull()
  })

  it('sorts strings and does not mutate the input', () => {
    const copy = [...rows]
    expect(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(rows).toEqual(copy)
  })

  it('supports toggling the direction value', () => {
    const dirs: SortDir[] = ['asc', 'desc']
    expect(dirs.map((d) => sortRows(rows, 'score', d)[0].symbol)).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `npm run test`
Expected: PASS (4 tests) — `sort.ts` already implements this behavior; any failure is a real bug in `src/lib/sort.ts`, fix it there.

- [ ] **Step 8: Run the build**

Run: `npm run build`
Expected: clean (`tsc -b` + vite build succeed).

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/tsconfig.node.json frontend/src/test/setup.ts frontend/src/lib/sort.test.ts
git commit -m "test: add vitest infra and sortRows characterization tests"
```

---

### Task 2: Terminal-emerald design set, DESIGN.md, Chakra provider, theme toggle, shell

**Files:**
- Create: `frontend/DESIGN.md`
- Create: `frontend/src/theme/system.ts`
- Create: `frontend/src/components/ThemeToggle.tsx`
- Create: `frontend/src/components/__tests__/ThemeToggle.test.tsx`
- Generate + edit: `frontend/src/components/ui/provider.tsx`, `color-mode.tsx`, `toaster.tsx`, `tooltip.tsx` (Chakra CLI output)
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/index.html`
- Modify: `frontend/FRONTEND.md`

**Interfaces:**
- Consumes: Task 1 test infra.
- Produces: `Provider` (Chakra + next-themes) wrapping the app; `Toaster` + `toaster` from `@/components/ui/toaster`; `useColorMode` from `@/components/ui/color-mode`; `ThemeToggle`; Terminal-emerald CSS vars in `index.css`; `system` from `src/theme/system.ts`. Tasks 4–8 rely on these.

- [ ] **Step 1: Install Chakra and generate snippets**

```powershell
npm install @chakra-ui/react @emotion/react
npx @chakra-ui/cli snippet add provider color-mode toaster tooltip
```

Expected: `frontend/src/components/ui/` gains `provider.tsx`, `color-mode.tsx`, `toaster.tsx`, `tooltip.tsx`; `next-themes` is added to `package.json`. If the CLI fails, create the four files manually per the chakra-ui-builder skill. If `react-icons` was installed, replace its imports in snippets with `lucide-react` equivalents and `npm uninstall react-icons`.

- [ ] **Step 2: Create `frontend/src/theme/system.ts`**

```ts
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  preflight: false,
  theme: {
    semanticTokens: {
      colors: {
        brand: {
          value: { base: '{colors.emerald.600}', _dark: '{colors.emerald.500}' },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
```

- [ ] **Step 3: Apply the Terminal-emerald tokens in `frontend/src/index.css`**

In `:root`, set `--primary: oklch(0.596 0.145 163.225)`, `--primary-foreground: oklch(0.985 0 0)`, `--ring: oklch(0.596 0.145 163.225)`, `--chart-1: oklch(0.596 0.145 163.225)`. In `.dark`, set `--primary: oklch(0.696 0.17 162.48)`, `--primary-foreground: oklch(0.145 0 0)`, `--ring: oklch(0.696 0.17 162.48)`, `--chart-1: oklch(0.696 0.17 162.48)`, and change `--sidebar-primary` to the same emerald as `--primary`. Leave all other vars unchanged.

- [ ] **Step 4: Create `frontend/DESIGN.md`**

Sections, using the pinned values from the spec (Revision 2, section A):

1. **Palette** — table of the emerald/zinc/red token values above with the rule "both token files must match this table"; gain = emerald, loss = red.
2. **Typography** — Geist Variable; sizes 12/14/16/18/20–24; `tabular-nums` required on every numeric data cell.
3. **Shape and spacing** — radii 6/8/10, 1px hairlines, 4px grid, elevation only on overlays.
4. **Motion** — durations 150/220/320 ms; no looping animation in data areas; `prefers-reduced-motion` → instant/static.
5. **Icons** — lucide-react only; 16px default, 14px in table headers; `strokeWidth={1.75}`; decorative `aria-hidden`; icon-only buttons `aria-label`; no `react-icons`.
6. **3D** — decorative, lazy, hidden below `md`, paused when tab hidden, reduced-motion/WebGL fallbacks.
7. **Light/dark parity** — both modes explicitly designed; AA contrast.

- [ ] **Step 5: Wire the provider — edit `frontend/src/components/ui/provider.tsx`**

Render `ChakraProvider` with `value={system}` from `@/theme/system`, wrapping the next-themes `ThemeProvider` with exactly:

```tsx
<ThemeProvider
  attribute="class"
  storageKey="stock-analyzer-theme"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
```

Keep the snippet's export shape (`export function Provider({ children }: { children: React.ReactNode })`).

- [ ] **Step 6: Wrap the app — edit `frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { Provider } from './components/ui/provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 7: Write the failing toggle tests — `frontend/src/components/__tests__/ThemeToggle.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '../ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('renders an accessible trigger', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /color mode/i })).toBeInTheDocument()
  })

  it('switches to dark mode via the menu', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Dark'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('persists the choice under the stock-analyzer-theme key', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: /color mode/i }))
    await user.click(await screen.findByText('Light'))
    await waitFor(() => expect(localStorage.getItem('stock-analyzer-theme')).toBe('light'))
  })

  it('renders with corrupt persisted theme', () => {
    localStorage.setItem('stock-analyzer-theme', '{not json')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /color mode/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/ThemeToggle.test.tsx`
Expected: FAIL — cannot resolve `../ThemeToggle`.

- [ ] **Step 9: Implement `frontend/src/components/ThemeToggle.tsx`**

Chakra `Menu.Root` + `Menu.Trigger` wrapping an `IconButton` with `aria-label="Color mode"`, `variant="ghost"`, size `sm`. Icon: lucide `Moon` when the resolved mode is dark, else `Sun` (16px, `aria-hidden`). Items `Light`, `Dark`, `System` call `setColorMode('light' | 'dark' | 'system')`; mark the active item with a check. No `react-icons`.

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/ThemeToggle.test.tsx`
Expected: PASS (4 tests). If the persistence assertion fails, check the actual `localStorage` value in a browser (`npm run dev`) and align the test with the library's real format.

- [ ] **Step 11: Add the no-flash script and real title — edit `frontend/index.html`**

Insert in `<head>`, after the viewport meta:

```html
<script>
  try {
    var stored = localStorage.getItem('stock-analyzer-theme')
    var dark = !stored || stored === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : stored === 'dark'
    document.documentElement.classList.toggle('dark', dark)
  } catch (e) {}
</script>
```

Change `<title>frontend</title>` to `<title>Stock Analyzer</title>`.

- [ ] **Step 12: Switch the shell to semantic tokens and mount toggle + toaster — edit `frontend/src/App.tsx`**

- Root div: `className="min-h-screen bg-background text-foreground"`.
- Nav: `border-b border-border px-6 py-3 flex items-center gap-6`; brand span unchanged; `NavLink` active `text-foreground font-semibold`, inactive `text-muted-foreground hover:text-foreground`; add `<ThemeToggle />` with `ml-auto` and mount `<Toaster />` once at the shell.
- Imports: `ThemeToggle` from `./components/ThemeToggle`, `Toaster` from `@/components/ui/toaster`.

- [ ] **Step 13: Update `frontend/FRONTEND.md`**

- Stack: add Chakra UI v3 (hybrid rules), `@emotion/react`, `next-themes`; link `DESIGN.md` as the design contract; note lucide-only icons.
- Theming: single `.dark` class from next-themes `attribute="class"`; `preflight: false`; Terminal emerald; never hardcode `zinc-950`/`zinc-100` in shell components.
- Commands: add `npm run test` (vitest, offline, mocks only).

- [ ] **Step 14: Run full tests + build**

Run: `npm run test` then `npm run build`
Expected: PASS; clean.

- [ ] **Step 15: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/index.html frontend/DESIGN.md frontend/src/main.tsx frontend/src/App.tsx frontend/src/index.css frontend/src/theme/system.ts frontend/src/components/ThemeToggle.tsx frontend/src/components/__tests__/ThemeToggle.test.tsx frontend/src/components/ui frontend/FRONTEND.md
git commit -m "feat: Terminal-emerald design set, Chakra provider, light/dark toggle, semantic-token shell"
```

---

### Task 3: Typed API errors in `api/client.ts`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/api/__tests__/client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ApiError` class (`status: number`, `detail: string`, both public fields); `api.get` / `api.post` reject with `ApiError` whose `message` includes the backend `detail` when present. Task 7 relies on `e.message` containing that detail.

- [ ] **Step 1: Write the failing tests — `frontend/src/api/__tests__/client.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../client'

afterEach(() => vi.restoreAllMocks())

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

describe('api client', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ hello: 'world' }) })
    await expect(api.get<{ hello: string }>('/thing')).resolves.toEqual({ hello: 'world' })
  })

  it('throws ApiError with backend detail', async () => {
    mockFetch({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({ detail: 'pe_max must be a number' }),
    })
    const err = await api.post('/screen/config/reload', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as Error).message).toContain('pe_max must be a number')
  })

  it('falls back to status text when the body is not JSON', async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json')
      },
    })
    const err = await api.get('/screen/latest').catch((e: unknown) => e)
    expect((err as Error).message).toContain('500')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/api/__tests__/client.test.ts`
Expected: FAIL — `ApiError` is not exported.

- [ ] **Step 3: Implement `frontend/src/api/client.ts`**

```ts
export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}
```

`request<T>` keeps `BASE = '/api'` and the existing headers; on `!res.ok`, read the body as JSON inside `try/catch`, take `body.detail` when it is a string, otherwise `res.statusText`; `throw new ApiError(res.status, detail)`. No parameter properties, no `any`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/api/__tests__/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/__tests__/client.test.ts
git commit -m "feat: surface backend error detail through typed ApiError"
```

---

### Task 4: Chakra `CriteriaPanel` with reload + error state

**Files:**
- Modify (rewrite): `frontend/src/components/CriteriaPanel.tsx`
- Create: `frontend/src/components/__tests__/CriteriaPanel.test.tsx`

**Interfaces:**
- Consumes: `ScreenConfig` from `src/api/types.ts`.
- Produces:

```ts
export function CriteriaPanel(props: {
  config: ScreenConfig | null
  onReload: () => void
  reloading?: boolean
  error?: string | null
}): JSX.Element
```

- Labels map: `pe_max` → `PE ≤ v`, `pb_max` → `PB ≤ v`, `roe_min` → `ROE ≥ v%`, `roce_min` → `ROCE ≥ v%`, `debt_to_equity_max` → `D/E ≤ v`, `market_cap_min` → `Mkt Cap ≥ ₹v cr`; unknown key → `` `${key}: ${value}` ``; plus `Top {shortlist_size}` badge.

- [ ] **Step 1: Write the failing tests — `frontend/src/components/__tests__/CriteriaPanel.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CriteriaPanel } from '../CriteriaPanel'
import { Provider } from '../ui/provider'

const renderPanel = (ui: React.ReactElement) => render(<Provider>{ui}</Provider>)

const config = {
  criteria: { pe_max: 25, roe_min: 15, custom_ratio: 3 },
  shortlist_size: 10,
}

describe('CriteriaPanel', () => {
  it('renders config entries with human labels and the top-N badge', () => {
    renderPanel(<CriteriaPanel config={config} onReload={() => {}} />)
    expect(screen.getByText('PE ≤ 25')).toBeInTheDocument()
    expect(screen.getByText('ROE ≥ 15%')).toBeInTheDocument()
    expect(screen.getByText('Top 10')).toBeInTheDocument()
  })

  it('renders unknown keys with a fallback label', () => {
    renderPanel(<CriteriaPanel config={config} onReload={() => {}} />)
    expect(screen.getByText('custom_ratio: 3')).toBeInTheDocument()
  })

  it('calls onReload when the reload button is clicked', async () => {
    const onReload = vi.fn()
    renderPanel(<CriteriaPanel config={config} onReload={onReload} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /reload config/i }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('shows the reload hint and surfaces errors', () => {
    renderPanel(
      <CriteriaPanel config={null} onReload={() => {}} error="Invalid screening.yaml" />,
    )
    expect(screen.getByText(/backend\/config\/screening\.yaml/)).toBeInTheDocument()
    expect(screen.getByText('Invalid screening.yaml')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/CriteriaPanel.test.tsx`
Expected: FAIL — current component takes no `reloading`/`error` and does not render `Top 10` as text.

- [ ] **Step 3: Implement `frontend/src/components/CriteriaPanel.tsx` (Chakra)**

Structure: `Box borderWidth="1px" borderColor="border" rounded="lg" p={4} bg="bg.panel"`; header `Flex justify="space-between" align="center" mb={2}` with `Text fontWeight="semibold" fontSize="sm"` and `Button size="sm" variant="outline" loading={reloading}`; criteria `Wrap gap={2}` of `Badge variant="subtle"`; hint `Text mt={2} fontSize="xs" color="fg.muted"` containing `backend/config/screening.yaml`; if `error` render `Text mt={2} fontSize="sm" color="fg.error" role="alert"`; if `config === null` show `Text` "Criteria unavailable" instead of the badge wrap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/CriteriaPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CriteriaPanel.tsx frontend/src/components/__tests__/CriteriaPanel.test.tsx
git commit -m "feat: rebuild CriteriaPanel with Chakra, reload state, and error display"
```

---

### Task 5: Motion primitives (reduced-motion aware)

**Files:**
- Modify: `frontend/package.json` (`motion` dependency)
- Create: `frontend/src/lib/usePrefersReducedMotion.ts`
- Create: `frontend/src/components/ui/NumberTicker.tsx`
- Create: `frontend/src/components/ui/BlurFade.tsx`
- Create: `frontend/src/components/ui/BorderBeam.tsx`
- Create: `frontend/src/components/ui/DotPattern.tsx`
- Create: `frontend/src/components/__tests__/NumberTicker.test.tsx`
- Create: `frontend/src/components/__tests__/BlurFade.test.tsx`
- Create: `frontend/src/components/__tests__/BorderBeam.test.tsx`
- Create: `frontend/src/components/__tests__/DotPattern.test.tsx`

**Interfaces:**
- Consumes: DESIGN.md motion rules; `@dnd` no.
- Produces:
  - `usePrefersReducedMotion(): boolean` — listens to `(prefers-reduced-motion: reduce)`, SSR/jsdom safe (defaults `false` when `matchMedia` is missing).
  - `NumberTicker({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string })` — renders the formatted value in a `span` with `data-testid="number-ticker"`; animates from 0 to `value` over 320 ms; reduced motion → exact value immediately.
  - `BlurFade({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string })` — opacity/translate entrance; reduced motion → plain `div`.
  - `BorderBeam({ active = true, className }: { active?: boolean; className?: string })` — absolute overlay for a `relative` parent; renders nothing when `active` is false; reduced motion → static 1px emerald ring (`data-testid="border-beam-static"`), otherwise an animated element (`data-testid="border-beam"`).
  - `DotPattern({ className, width = 20, height = 20, radius = 1 }: { className?: string; width?: number; height?: number; radius?: number })` — decorative SVG, `aria-hidden`.
- Tasks 7–8 consume all four.

- [ ] **Step 1: Install `motion`**

```powershell
npm install motion
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/__tests__/NumberTicker.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberTicker } from '../ui/NumberTicker'

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

afterEach(() => vi.restoreAllMocks())

describe('NumberTicker', () => {
  it('renders the final value', async () => {
    render(<NumberTicker value={42} />)
    await waitFor(() => expect(screen.getByTestId('number-ticker')).toHaveTextContent('42'))
  })

  it('renders the exact value instantly under reduced motion', () => {
    mockReducedMotion(true)
    render(<NumberTicker value={123} decimals={1} />)
    expect(screen.getByTestId('number-ticker')).toHaveTextContent('123.0')
  })
})
```

`frontend/src/components/__tests__/BlurFade.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlurFade } from '../ui/BlurFade'

afterEach(() => vi.restoreAllMocks())

describe('BlurFade', () => {
  it('renders children', () => {
    render(<BlurFade><span>content</span></BlurFade>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders children with reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    render(<BlurFade><span>content</span></BlurFade>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
```

`frontend/src/components/__tests__/BorderBeam.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BorderBeam } from '../ui/BorderBeam'

afterEach(() => vi.restoreAllMocks())

describe('BorderBeam', () => {
  it('renders nothing when inactive', () => {
    render(<BorderBeam active={false} />)
    expect(screen.queryByTestId('border-beam')).not.toBeInTheDocument()
    expect(screen.queryByTestId('border-beam-static')).not.toBeInTheDocument()
  })

  it('renders an animated beam by default', () => {
    render(<BorderBeam />)
    expect(screen.getByTestId('border-beam')).toBeInTheDocument()
  })

  it('renders a static ring under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    render(<BorderBeam />)
    expect(screen.getByTestId('border-beam-static')).toBeInTheDocument()
    expect(screen.queryByTestId('border-beam')).not.toBeInTheDocument()
  })
})
```

`frontend/src/components/__tests__/DotPattern.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DotPattern } from '../ui/DotPattern'

describe('DotPattern', () => {
  it('renders a decorative svg', () => {
    const { container } = render(<DotPattern />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__`
Expected: FAIL — the four modules do not exist.

- [ ] **Step 4: Implement the hook and components**

- `usePrefersReducedMotion`: `useEffect` + `matchMedia('(prefers-reduced-motion: reduce)')` with `addEventListener('change')` and cleanup; initial value `matchMedia?.(...).matches ?? false` computed lazily.
- `NumberTicker`: if reduced motion → `value.toFixed(decimals)`; else `useEffect` runs `animate(0, value, { duration: 0.32, onUpdate: setDisplay })` from `motion`, cleanup cancels; format with `toFixed(decimals)`. Render `<span data-testid="number-ticker">{display}</span>` with `tabular-nums`.
- `BlurFade`: reduced motion → `<div className={className}>{children}</div>`; else `motion.div` with `initial={{ opacity: 0, filter: 'blur(4px)', y: 8 }}` → `animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}`, `transition={{ duration: 0.32, delay }}`.
- `BorderBeam`: `active === false` → `null`; reduced motion → `<span data-testid="border-beam-static" aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-primary/40" />`; else `<span data-testid="border-beam" aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">` containing a `motion.span` with a conic emerald gradient translating along the edge (Magic UI pattern, restyled).
- `DotPattern`: `<svg aria-hidden="true" className={className}>` with a `<pattern>` of circles; no animation.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__`
Expected: PASS (8 tests across the four files). If `motion`'s animation timing makes the ticker flaky in CI, keep the 320 ms duration and `waitFor` default timeout.

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/usePrefersReducedMotion.ts frontend/src/components/ui/NumberTicker.tsx frontend/src/components/ui/BlurFade.tsx frontend/src/components/ui/BorderBeam.tsx frontend/src/components/ui/DotPattern.tsx frontend/src/components/__tests__/NumberTicker.test.tsx frontend/src/components/__tests__/BlurFade.test.tsx frontend/src/components/__tests__/BorderBeam.test.tsx frontend/src/components/__tests__/DotPattern.test.tsx
git commit -m "feat: reduced-motion-aware motion primitives (ticker, blur fade, border beam, dot pattern)"
```

---

### Task 6: Three.js ambient field + run visual (lazy, gated, tested)

**Files:**
- Modify: `frontend/package.json` (`three`, `@react-three/fiber`, `@types/three`)
- Create: `frontend/src/lib/webgl.ts`
- Create: `frontend/src/lib/webgl.test.ts`
- Create: `frontend/src/components/three/AmbientField.tsx`
- Create: `frontend/src/components/three/RunVisual.tsx`
- Create: `frontend/src/components/three/__tests__/AmbientField.test.tsx`
- Create: `frontend/src/components/three/__tests__/RunVisual.test.tsx`
- Modify: `frontend/src/App.tsx` (mount lazy `AmbientField`)

**Interfaces:**
- Consumes: `usePrefersReducedMotion` (Task 5); emerald vars (Task 2).
- Produces: `hasWebGL(): boolean`; default exports `AmbientField` and `RunVisual` — both render `null` when `!hasWebGL()` or reduced motion; `AmbientField` props `{ className?: string }`; `RunVisual` props `{ size?: number }`. Task 7 imports `RunVisual` via `React.lazy`.

- [ ] **Step 1: Install 3D dependencies**

```powershell
npm install three @react-three/fiber
npm install --save-dev @types/three
```

- [ ] **Step 2: Write the failing tests — `frontend/src/lib/webgl.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { hasWebGL } from './webgl'

describe('hasWebGL', () => {
  it('returns false when a context cannot be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(hasWebGL()).toBe(false)
  })

  it('returns true when a webgl context exists', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    expect(hasWebGL()).toBe(true)
  })
})
```

`frontend/src/components/three/__tests__/AmbientField.test.tsx` and `RunVisual.test.tsx` (same shape for both):

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webgl', () => ({ hasWebGL: () => false }))

import AmbientField from '../AmbientField'

describe('AmbientField', () => {
  it('renders nothing without WebGL', () => {
    const { container } = render(<AmbientField />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

Repeat for `RunVisual` with `import RunVisual from '../RunVisual'` and `render(<RunVisual />)`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/webgl.test.ts src/components/three`
Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement `frontend/src/lib/webgl.ts`**

```ts
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    )
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Implement `AmbientField` and `RunVisual`**

- `AmbientField.tsx` (default export): guard `if (!hasWebGL() || usePrefersReducedMotion()) return null`; render `<Canvas aria-hidden className={...} dpr={[1, 1.5]} camera={{ position: [0, 0, 6], fov: 45 }} gl={{ antialias: false, powerPreference: 'low-power' }}>` with a `<points>` object (buffer geometry of ~800 random positions, `PointsMaterial` emerald, `size={0.02}`, `transparent`, `opacity={0.35}`) slowly rotating via `useFrame`; pause rendering when `document.hidden` (subscribe to `visibilitychange` and set a state flag that skips rotation or returns `null` from the frame). Position fixed behind content: `className="pointer-events-none fixed inset-0 -z-10 hidden md:block"`.
- `RunVisual.tsx` (default export): same guards; `<Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 4], fov: 50 }}>` with a wireframe icosahedron (~160 px via `style={{ width: size, height: size }}`) in emerald, rotating via `useFrame`; pauses on hidden tab; `aria-hidden` on the wrapper.
- Both files must keep `three` out of the static import graph of `App.tsx` (only lazy import in App; see Step 6).

- [ ] **Step 6: Mount the ambient field in `frontend/src/App.tsx`**

```tsx
import { lazy, Suspense } from 'react'
const AmbientField = lazy(() => import('./components/three/AmbientField'))
```

Render `<Suspense fallback={null}><AmbientField /></Suspense>` as the first child of the root div (before `<nav>`). Do not statically import the 3D modules anywhere.

- [ ] **Step 7: Run tests, then build and verify chunking**

Run: `npm run test` → PASS.
Run: `npm run build`, then verify three is chunked:

```powershell
Get-ChildItem dist/assets | Sort-Object Length -Descending | Select-Object Name, Length
Select-String -Path dist/assets/*.js -Pattern 'WebGLRenderer' -List | Select-Object Filename
```

Expected: the `WebGLRenderer` match appears only in a dedicated async chunk (for example `AmbientField-*.js`), not in the entry `index-*.js`. Record both in the task commit message if the chunk name differs.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/webgl.ts frontend/src/lib/webgl.test.ts frontend/src/components/three frontend/src/App.tsx
git commit -m "feat: lazy WebGL-gated Three.js ambient field and run visual"
```

---

### Task 7: `Fundamentals` page — reload endpoint, enriched rows, motion, errors, empty state

**Files:**
- Modify (rewrite): `frontend/src/pages/Fundamentals.tsx`
- Create: `frontend/src/pages/__tests__/Fundamentals.test.tsx`
- Modify: `plan/phase-1-fundamental-screen/frontend.md`

**Interfaces:**
- Consumes: `ApiError` (Task 3), `CriteriaPanel` (Task 4), `NumberTicker`/`BlurFade`/`BorderBeam`/`DotPattern` (Task 5), `RunVisual` lazy (Task 6), `toaster` (Task 2).
- Produces: the complete Phase-1 page behavior; no exports.

- [ ] **Step 1: Write the failing tests — `frontend/src/pages/__tests__/Fundamentals.test.tsx`**

Mock the api module; mock the lazy 3D module so jsdom never touches it.

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fundamentals from '../Fundamentals'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}))

vi.mock('../../components/three/RunVisual', () => ({ default: () => null }))

const mockedApi = vi.mocked(api)

const config = { criteria: { pe_max: 25 }, shortlist_size: 10 }
const row = {
  symbol: 'TCS',
  rank: 1,
  score: 38.2,
  ratios: { pe: 22.1, pb: 4.1, roe: 41, roce: 50.2, debt_to_equity: 0.09 },
  name: 'Tata Consultancy Services',
  sector: 'IT',
  market_cap: 1200000,
}

beforeEach(() => vi.resetAllMocks())

describe('Fundamentals', () => {
  it('shows an error when initial loads fail', async () => {
    mockedApi.get.mockRejectedValue(new Error('API error 500: boom'))
    render(<Fundamentals />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/)
  })

  it('renders the latest run rows with stock metadata', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [row] })
    render(<Fundamentals />)
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('1200000.0')).toBeInTheDocument()
  })

  it('shows empty state for a zero-row run', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
      .mockResolvedValueOnce({ run_id: 2, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockResolvedValue({ run_id: 2, shortlisted: [], failed_count: 500, total: 500 })
    render(<Fundamentals />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /run screen/i }))
    expect(await screen.findByText(/no stocks passed the screen/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent('0 shortlisted · 500 failed · 500 total'),
    )
  })

  it('reloads config through POST /screen/config/reload', async () => {
    mockedApi.get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ run_id: 1, run_date: '2026-09-26', shortlisted: [] })
    mockedApi.post.mockResolvedValue({ ...config, criteria: { pe_max: 30 } })
    render(<Fundamentals />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /reload config/i }))
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/screen/config/reload', {}),
    )
    expect(await screen.findByText('PE ≤ 30')).toBeInTheDocument()
  })
})
```

Note on the summary assertion: the summary container must carry `data-testid="summary"` and `toHaveTextContent` is used because the numbers render inside `NumberTicker` spans; the exact final string is asserted once the tickers settle.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/__tests__/Fundamentals.test.tsx`
Expected: FAIL — reload calls `GET`, no empty state, no reload-response usage.

- [ ] **Step 3: Rewrite `frontend/src/pages/Fundamentals.tsx`**

State: `config: ScreenConfig | null`, `configError: string | null`, `reloading: boolean`, `rows: ShortlistRow[]`, `summary: string`, `running: boolean`, `error: string | null`.

- `loadConfig()`: `api.get<ScreenConfig>('/screen/config')`; success → config + clear `configError`; catch → `configError` = `e.message`.
- `reloadConfig()`: set `reloading`; `api.post<ScreenConfig>('/screen/config/reload', {})`; success → config + clear `configError`; catch → `configError` + `toaster.create({ title: 'Config reload failed', description: message, type: 'error' })`; finally clear `reloading`.
- `loadLatest()`: `api.get<LatestScreen>('/screen/latest')`; success → rows + `Last run: ${run_date}`; catch → ignore 404 (`e instanceof ApiError && e.status === 404`), else `error` = message.
- Mount effect calls both.
- `runScreen()`: set `running`, clear `error`; `api.post<ScreenRunResult>('/screen/run', {})`; set summary from `res`; then try `api.get<LatestScreen>('/screen/latest')` and set rows from it (fallback: `res.shortlisted` + toast); catch → `error` + toast; finally clear `running`.
- Render: heading `Text fontSize="xl" fontWeight="semibold"`; run `Button` (`loading={running}`, `loadingText="Running…"`, `colorPalette="emerald"`); while running show hint text "Fetching fundamentals for ~500 stocks — takes a few minutes" plus lazy `RunVisual`; run card wrapped in `BlurFade` with `BorderBeam active={running}` (parent `position="relative"`); summary line root gets `data-testid="summary"`, with each number rendered by a `NumberTicker` and the separators (` shortlisted · `, ` failed · `, ` total`) as static text; `error` as `Text role="alert" color="fg.error"`; `CriteriaPanel` always rendered (`config`, `configError`, `reloading`, `onReload={reloadConfig}`); table wrapped in `BlurFade` when `rows.length > 0`; when `!running && summary && rows.length === 0` show empty state with `DotPattern` background and text "No stocks passed the screen."
- Keep `space-y-4` layout; no global store.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/__tests__/Fundamentals.test.tsx`
Expected: PASS (4 tests). If mock call-ordering is brittle, restructure the mocks to key off the URL argument instead of order.

- [ ] **Step 5: Update `plan/phase-1-fundamental-screen/frontend.md`**

- CriteriaPanel bullet: reload button → `POST /screen/config/reload` returning the fresh config; errors shown in the panel; DESIGN.md is the design contract.
- RunButton bullet: after a successful run, rows come from `GET /screen/latest` (enriched with name/sector/market_cap); note the zero-row empty state and the reduced-motion-aware motion/3D decorations.
- State bullet: mount failures surface an inline error (404 from `/screen/latest` = "no run yet" and is ignored).
- Tests section: list the real vitest files and `npm run test`.

- [ ] **Step 6: Run full tests + build**

Run: `npm run test` then `npm run build`
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Fundamentals.tsx frontend/src/pages/__tests__/Fundamentals.test.tsx plan/phase-1-fundamental-screen/frontend.md
git commit -m "feat: wire Fundamentals run loop to reload endpoint, enriched rows, motion, and error/empty states"
```

---

### Task 8: `ShortlistTable` accessibility and placeholder fixes

**Files:**
- Modify: `frontend/src/components/ShortlistTable.tsx`
- Create: `frontend/src/components/__tests__/ShortlistTable.test.tsx`

**Interfaces:**
- Consumes: `ShortlistRow`, `sortRows`.
- Produces: same public component (`{ rows }`), plus `aria-sort` on sortable headers, keyboard-operable sort buttons, `tabular-nums` on numeric cells.

- [ ] **Step 1: Write the failing tests — `frontend/src/components/__tests__/ShortlistTable.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ShortlistTable } from '../ShortlistTable'
import type { ShortlistRow } from '../../api/types'

function makeRow(overrides: Partial<ShortlistRow>): ShortlistRow {
  return {
    symbol: 'AAA',
    rank: 1,
    score: 10,
    ratios: { pe: 20, pb: 3, roe: 15, roce: 20, debt_to_equity: 0.1 },
    ...overrides,
  }
}

const rows: ShortlistRow[] = [
  makeRow({ symbol: 'LOW', rank: 2, score: 5, ratios: { pe: null, pb: null, roe: null, roce: null, debt_to_equity: null } }),
  makeRow({ symbol: 'HIGH', rank: 1, score: 50 }),
]

describe('ShortlistTable', () => {
  it('renders placeholders for missing values', () => {
    render(<ShortlistTable rows={rows} />)
    const lowRow = screen.getByText('LOW').closest('tr')!
    expect(within(lowRow).getAllByText('—').length).toBeGreaterThanOrEqual(5)
  })

  it('does not badge a null D/E', () => {
    render(<ShortlistTable rows={[rows[0]]} />)
    expect(screen.queryByText('0.1')).not.toBeInTheDocument()
  })

  it('badges D/E above 0.3 and not at 0.3', () => {
    const { unmount } = render(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.31 } })]} />)
    expect(screen.getByText('0.3').className).toContain('bg-destructive')
    unmount()
    render(<ShortlistTable rows={[makeRow({ ratios: { pe: 1, pb: 1, roe: 1, roce: 1, debt_to_equity: 0.3 } })]} />)
    expect(screen.getByText('0.3').className).not.toContain('bg-destructive')
  })

  it('sorts by score on header click and exposes aria-sort', async () => {
    const user = userEvent.setup()
    render(<ShortlistTable rows={rows} />)
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'none')
    await user.click(screen.getByRole('button', { name: /score/i }))
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(within(bodyRows[0]).getByText('LOW')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /score/i })).toHaveAttribute('aria-sort', 'ascending')
  })
})
```

Note: the badge class assertion uses shadcn's destructive token `bg-destructive`; if the installed variant emits a different class, read `src/components/ui/badge.tsx` and assert the actual class it applies.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/ShortlistTable.test.tsx`
Expected: FAIL — headers are not keyboard-focusable buttons and have no `aria-sort`.

- [ ] **Step 3: Implement the changes in `frontend/src/components/ShortlistTable.tsx`**

- Each `TableHead` contains a real `<button type="button">` with the label + arrow, `onClick={() => toggleSort(col.key)}`; clicking the header itself is no longer the only handler.
- `TableHead` gets `aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}`.
- Numeric cells keep `text-right` and gain `tabular-nums`; Rank and Score stay right-aligned; `fmt` and the D/E badge logic (> 0.3) are unchanged.
- Row key stays `r.symbol`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/ShortlistTable.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full tests + build**

Run: `npm run test` then `npm run build`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ShortlistTable.tsx frontend/src/components/__tests__/ShortlistTable.test.tsx
git commit -m "fix: keyboard-accessible sortable headers, aria-sort, and tabular numerals"
```

---

### Task 9: Full verification + acceptance checklist

**Files:**
- No code changes. If a check fails, fix in the owning task's files and add a fix commit.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified Phase-1 frontend.

- [ ] **Step 1: Automated checks**

Run from `frontend/`:

```powershell
npm run test
npm run build
Get-ChildItem dist/assets | Sort-Object Length -Descending | Select-Object Name, Length
```

Expected: all tests PASS; build clean; `three` present only in an async chunk (see Task 6 Step 7 for the check).

- [ ] **Step 2: Manual verification in the dev server**

Run (from `frontend/`): `npm run dev`

Checks 1–4, 7 and 8 are frontend-only. Checks 5 and 6 need the live backend endpoints owned by a parallel backend effort; if they are not ready, mark them "deferred (backend pending)". Report each pass/fail:

1. First visit follows OS preference; toggle sets Light, Dark, System; choice survives a full reload; no flash of the wrong theme.
2. Both modes match DESIGN.md: nav, criteria panel, table headers, summary, buttons readable; emerald accents; tabular numerals; lucide icons at 16/14px.
3. Motion: summary numbers tick up (~320 ms), panels/table fade in; no looping animation in data areas; run card shows a border beam only while running.
4. Reduced motion: enable OS "reduce motion" (or DevTools rendering emulation) → ticker shows final values instantly, no beam, no fades, 3D absent.
5. Run Screen (live): loading text + 3D run visual; on completion the exact summary line and a table with Name / Sector / Mkt Cap populated without a page reload.
6. Reload config: edit a threshold in `backend/config/screening.yaml`, click Reload config → badge updates. Break the YAML (`pe_max: abc`), reload → error in the panel, no crash.
7. 3D: ambient field visible behind content on ≥ md only, low-key in both themes, pauses when the tab is hidden; below `md` it is absent.
8. Failure states: stop the backend and reload → inline error, no blank page; zero-row run → empty state with dot pattern.

- [ ] **Step 3: Report**

Summarize each check with evidence (command output or observed behavior), marking backend-dependent checks deferred if applicable.
