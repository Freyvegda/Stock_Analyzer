# Phase 1.7 — Frontend (saved screens, inline criteria editor, navbar search)

> **For agentic workers:** part of the Phase 1.7 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-29-phase-1.7-saved-screens-design.md`.
> Backend contract: `plan/phase-1.7/backend.md`. Design contract: `frontend/DESIGN.md`.

**Goal:** `/fundamentals/criteria` gets a saved-screen picker and a dialog-free inline criteria
editor (category sub-accordions); Top 10 follows the active screen; the navbar search becomes
an always-visible 3D-glass bar on desktop.

**Architecture:** `FundamentalsLayout` keeps owning shared state and gains sets
(`/screen/sets`) + active screen; new `ScreenSetPicker` and `CriteriaEditor` components render
the page; `CriteriaPanel` becomes the active-screen summary; `CriteriaDialog` is deleted.
`NavSearch` keeps its client-side filter + results panel but promotes the input to a permanent
`.glass-field` bar ≥ md.

**Tech stack:** React 19, TS, Vite, Chakra UI v3, Tailwind v4, lucide, motion, vitest + jsdom
+ Testing Library. No new dependencies.

## Global Constraints

- Work dir: `frontend/`. Tests: `npm run test`. Build: `npm run build` (must stay clean).
- Tests run offline; mock the `api` client, never `fetch`.
- `frontend/DESIGN.md` binds: semantic tokens only (Chakra `sakura`/`fg.muted`, Tailwind
  `bg-card`/`border-border`/`text-muted-foreground`), Geist + Geist Mono, every number through
  `Num`/`Delta`, lucide 16px `strokeWidth={1.75}` + `aria-hidden`, icon-only buttons need
  `aria-label`, `tabular-nums`, durations 120/200/320 ms, reduced-motion via
  `usePrefersReducedMotion`, `vault-rules.test.ts` bans hex/raw palette classes.
- No dialog opens anywhere in the criteria flow. No new dialog/`Portal` usage.
- `verbatimModuleSyntax` (`import type`), no enums, `noUnusedLocals`.
- One `GET /stocks` fetch per shell mount for `NavSearch` stays.

## Review Focus

Failure modes most likely to bite; each has a test in the task that owns the code.

1. Unsaved edits must not vanish silently when switching screens — F3
   (`shows the unsaved-changes bar and saves before switching`).
2. `Run Screen` after editing must execute the edited criteria — F3
   (`saves the draft before running`).
3. Verdict/Top 10 must follow the activated screen — F1
   (`activation refetches the latest run`).
4. Navbar search must stay keyboard-complete while always visible — F4
   (`Ctrl+K focuses the input`, `arrows and Enter open a stock`).
5. Editor must render with a set whose criteria contain catalog-unknown keys — F2
   (`skips unknown keys instead of crashing`).

---

### Task F1: Types + layout state for screening sets

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/pages/fundamentals/FundamentalsLayout.tsx`
- Modify: `frontend/src/pages/__tests__/FundamentalsLayout.test.tsx`

**Interfaces:**

```ts
export interface ScreeningSet {
  id: number
  name: string
  criteria: Criterion[]
  thesis: string | null
  shortlist_size: number
  is_active: boolean
  updated_at: string
}
export type ScreeningSetChanges = { name?: string; criteria?: Criterion[]; thesis?: string | null }
```

- Remove `UserCriteria` (no longer used anywhere after this phase).
- `FundamentalsOutletContext` gains:
  `sets: ScreeningSet[]`, `activeSet: ScreeningSet | null`, `setsError: string | null`,
  `activateSet: (id: number) => Promise<void>`,
  `createSet: (name: string) => Promise<ScreeningSet>`,
  `updateSet: (id: number, changes: ScreeningSetChanges) => Promise<ScreeningSet>`,
  `deleteSet: (id: number) => Promise<void>`;
  drops `criteria` and `saveCriteria`.
- Layout internals: `loadSets()` → `GET /screen/sets`; `loadLatest()` unchanged
  (`GET /screen/latest` is already active-set scoped server-side). `activateSet` → `POST
  /screen/sets/{id}/activate`, updates `sets`, then `loadLatest()`. `createSet` → `POST
  /screen/sets` (body `{name}`) then reload sets + latest (new set is active server-side).
  `updateSet` → `PUT /screen/sets/{id}` with only provided keys; updates the set in place.
  `deleteSet` → `DELETE /screen/sets/{id}`, reload sets + latest. Failures throw `Error`
  with the API detail; `setsError` surfaces load failures.

- [ ] **Step 1: Write the failing tests** — extend `frontend/src/pages/__tests__/FundamentalsLayout.test.tsx`

Mock `../../api/client`. Fixtures: `SET_A` ("Default", active, pe≥25), `SET_B` ("Quality",
PE≤15). Cases:

```tsx
it('loads saved screens and the active one')          // both names render via outlet probe
it('activation refetches the latest run')             // api.post '/screen/sets/2/activate', api.get '/screen/latest' called twice
it('sets error renders without killing the page')     // GET /screen/sets 500 -> setsError text, run state still loads
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/__tests__/FundamentalsLayout.test.tsx`
Expected: FAIL — `ScreeningSet` missing / context fields absent.

- [ ] **Step 3: Implement**

- `types.ts`: add `ScreeningSet`, `ScreeningSetChanges`; delete `UserCriteria`.
- `FundamentalsLayout.tsx`: replace `loadCriteria` with `loadSets`; add the five actions;
  thread them through the outlet context. Keep `useStatusFact` and the run interval exactly
  as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/__tests__/FundamentalsLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/fundamentals/FundamentalsLayout.tsx frontend/src/pages/__tests__/FundamentalsLayout.test.tsx
git commit -m "feat: fundamentals layout owns saved screens and active-set actions"
```

---

### Task F2: `CriteriaEditor` — inline accordion editor

**Files:**
- Create: `frontend/src/components/CriteriaEditor.tsx`
- Test: `frontend/src/components/__tests__/CriteriaEditor.test.tsx`

**Interfaces:**

```ts
export function CriteriaEditor({
  open, onOpenChange, set, ratios, onSave, onDirtyChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  set: ScreeningSet | null                       // parent keys this component by set.id
  ratios: RatioSpec[]
  onSave: (criteria: Criterion[], thesis: string | null) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
})
```

- Outer Chakra `Accordion.Root` (`collapsible`, one item `value="editor"`, controlled by
  `open`/`onOpenChange`) — header "Criteria" + active screen name; collapsed by default.
- Body: one `Accordion.Root` (`multiple`, `defaultValue` = every category) of sub-accordions,
  one per `ratio.category` in catalog order; each header shows `enabled/total`. Rows: `Switch`
  (on/off), label + unit, direction glyph from `RatioSpec.direction` (`min` → `≥`, `max` →
  `≤`), `Input` (`inputMode="decimal"`, aria-label `${label} value`), remove `IconButton`.
- Per-category "Add criterion": Chakra `Combobox` listing that category's ratios not already
  in the draft (grouped collection like `CriteriaDialog` used).
- Thesis `Textarea` (maxLength 500 + counter). Save button; row-level + form-level error text
  (`role="alert"`).
- Validation mirrors the old dialog: finite numbers, ≥1 enabled, thesis ≤500. Draft seeded
  from `set`; `onDirtyChange` fires when draft ≠ saved. Rows for keys missing from the
  catalog render with the raw key and are removable, never crash.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders category sub-accordions and toggles rows')      // Valuation header, switch PE off
it('adds and removes a criterion in its category')
it('blocks save with an invalid threshold')                  // empty value -> "Enter a valid number", onSave not called
it('saves parsed criteria and thesis on Save')               // onSave([{key:'pe',enabled:true,value:20},...], 'hi')
it('skips unknown keys instead of crashing')                 // criteria key 'mystery' renders, page alive
it('reports dirty state changes')                            // onDirtyChange(true) after typing
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/CriteriaEditor.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement** following the interfaces above; reuse the old dialog's helpers
(`unitSuffix`, `errorMessage`) or move them into the new file. No `Portal`. Reduced motion:
accordion motion via Chakra defaults is acceptable; no custom loops.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/CriteriaEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CriteriaEditor.tsx frontend/src/components/__tests__/CriteriaEditor.test.tsx
git commit -m "feat: inline criteria editor with category sub-accordions"
```

---

### Task F3: Screen picker + page wiring; delete the dialog

**Files:**
- Create: `frontend/src/components/ScreenSetPicker.tsx`
- Modify: `frontend/src/components/CriteriaPanel.tsx`
- Modify: `frontend/src/pages/fundamentals/ScreeningCriteria.tsx`
- Delete: `frontend/src/components/CriteriaDialog.tsx`,
  `frontend/src/components/__tests__/CriteriaDialog.test.tsx`
- Test: `frontend/src/components/__tests__/ScreenSetPicker.test.tsx` (create),
  `frontend/src/components/__tests__/CriteriaPanel.test.tsx` (update),
  `frontend/src/pages/__tests__/ScreeningCriteria.test.tsx` (update)

**Interfaces:**

```ts
export function ScreenSetPicker({ sets, active, busy, onSelect, onCreate, onRename, onDelete }: {
  sets: ScreeningSet[]
  active: ScreeningSet | null
  busy?: boolean
  onSelect: (set: ScreeningSet) => void
  onCreate: (name: string) => Promise<void>
  onRename: (set: ScreeningSet, name: string) => Promise<void>
  onDelete: (set: ScreeningSet) => Promise<void>
})
```

- Picker: glass surface, active-marked option list (`role="listbox"`-free; Chakra buttons),
  inline New (input + Create), inline Rename (input), Delete with a two-step inline confirm
  (`Delete` → `Confirm? Yes/Cancel`). Errors inline (`role="alert"`), never a dialog.
- `CriteriaPanel({ set, ratios, onEdit, error }: { set: ScreeningSet | null; ratios: RatioSpec[];
  onEdit: () => void; error?: string | null })` — name + badge list (existing `badgeText`
  logic) + `Edit Criteria` button.
- `ScreeningCriteria` page: heading → picker → panel → editor (`key={activeSet?.id ?? 'none'}`)
  → Run card; state `editorOpen`, `dirty`, `pendingSwitch`:
  - `onSelect(next)`: dirty → `setPendingSwitch(next)` and show inline bar
    "Unsaved changes — Save & switch / Discard & switch"; clean → `activateSet(next.id)`.
  - Save & switch: `saveDraft()` then `activateSet`; failure keeps the bar + error.
    Discard & switch: `activateSet` only (editor is keyed, drafts reset on set change).
  - Run: if dirty → save first, then `runScreen()`; save failure aborts the run.
- Delete all `CriteriaDialog` imports/tests.

- [ ] **Step 1: Write the failing tests**

`ScreenSetPicker.test.tsx`:

```tsx
it('lists screens and marks the active one')
it('creates a new screen from the inline input')     // onCreate('Momentum')
it('renames inline and deletes with two-step confirm')
```

`ScreeningCriteria.test.tsx` (rewrite against layout context fixture):

```tsx
it('expands the inline editor from Edit Criteria')    // no dialog role appears
it('shows the unsaved-changes bar and saves before switching')
it('discards the draft when choosing Discard & switch')
it('saves the draft before running')                  // PUT then POST /screen/run
```

`CriteriaPanel.test.tsx`: update fixture to `ScreeningSet`; keep badge assertions; Edit button
calls `onEdit`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/ScreenSetPicker.test.tsx src/components/__tests__/CriteriaPanel.test.tsx src/pages/__tests__/ScreeningCriteria.test.tsx`
Expected: FAIL — picker missing, old props gone.

- [ ] **Step 3: Implement** per interfaces; delete the dialog files; update
`ScreeningCriteria` layout markup (keep `BlurFade`, run card, summary, elapsed, loaders
unchanged); Top 10 empty copy becomes "No run yet for this screen." in `TopTen.tsx` with the
same criteria link.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/__tests__/ScreenSetPicker.test.tsx src/components/__tests__/CriteriaPanel.test.tsx src/pages/__tests__/ScreeningCriteria.test.tsx src/pages/__tests__/TopTen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ScreenSetPicker.tsx frontend/src/components/CriteriaPanel.tsx frontend/src/pages/fundamentals/ScreeningCriteria.tsx frontend/src/pages/fundamentals/TopTen.tsx frontend/src/components/__tests__ frontend/src/pages/__tests__
git commit -m "feat: saved-screen picker + dialog-free criteria page; per-screen Top 10 copy"
```

---

### Task F4: Navbar search — always-visible glass bar

**Files:**
- Modify: `frontend/src/components/NavSearch.tsx`
- Modify: `frontend/src/index.css` (`.glass-field`)
- Modify: `frontend/DESIGN.md`
- Test: `frontend/src/components/__tests__/NavSearch.test.tsx`

**Interfaces:**

- Desktop (≥ md): the input is always rendered, `w-72` (18rem), `.glass-field` styling, a
  leading `Search` icon (16px, decorative) and a `⌘K`/`Ctrl K` hint inside; focus ring;
  results panel below unchanged (`glass-panel`, perspective entrance, sheen, stagger,
  verdict chips, listbox a11y). **Owner ruling (2026-09-29): the icon trigger and the
  leading icon were removed — the bar itself is the only affordance at every width.**
- Below md: the same bar fills its own row (no icon fallback).
- Ctrl/Cmd+K: `preventDefault`, focus the input (desktop) and open (mobile).
- One `GET /stocks` lazy fetch on first interaction/focus stays.

- [ ] **Step 1: Write the failing tests** — update `NavSearch.test.tsx`

```tsx
it('renders the search input without opening anything')      // input visible on desktop render
it('Ctrl+K focuses the input')                               // document keydown -> document.activeElement
it('shows matches, arrows move, Enter navigates')            // unchanged behavior
it('closes the panel on outside click')                      // unchanged
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/NavSearch.test.tsx`
Expected: FAIL — input only renders after opening.

- [ ] **Step 3: Implement**

`.glass-field` in `index.css` follows the `.glass-nav`/`.glass-panel` recipe: token-derived
`color-mix` gradient over `backdrop-filter: blur(10px) saturate(1.2)`, 1px mixed border,
inset top highlight, focus ring in `--ring`; no hex, no raw palette classes. Add the DESIGN.md
bullet under "Liquid-glass 3D navbar" describing the sanctioned field surface + size + the
mobile fallback. Capsule still never tilts.

- [ ] **Step 4: Run tests + build + rules**

Run: `npx vitest run src/components/__tests__/NavSearch.test.tsx src/components/__tests__/GlassNav.test.tsx src/theme/__tests__/vault-rules.test.ts && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NavSearch.tsx frontend/src/index.css frontend/DESIGN.md frontend/src/components/__tests__/NavSearch.test.tsx
git commit -m "feat: always-visible 3D glass navbar search bar"
```

---

### Task F6: Criterion bookmarks — ribbon toggle, pinning, filter (addendum)

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/components/CriteriaEditor.tsx`,
  `frontend/src/components/CriteriaPanel.tsx`
- Modify: `frontend/src/components/__tests__/CriteriaEditor.test.tsx`,
  `frontend/src/components/__tests__/CriteriaPanel.test.tsx`

**Interfaces:**
- `Criterion` gains `bookmarked?: boolean`.
- Draft rows gain `bookmarked`; the dirty snapshot and the Save payload include it
  (`bookmarked: false` when absent). Row ribbon: `IconButton` labelled `Bookmark <label>` /
  `Remove bookmark <label>` (lucide `Bookmark`, `fill="currentColor"` when active).
- Within a category, bookmarked rows pin above unbookmarked ones (stable otherwise).
- Filter chip `Bookmarked only` (`aria-pressed`) renders only bookmarked rows and hides
  categories with none; category headers keep counting the full set.
- `CriteriaPanel` badges for bookmarked criteria show a small decorative ribbon marker
  (`Bookmark` icon, `aria-hidden`, 14px).

- [ ] **Step 1: Write the failing tests**

```tsx
it('pins a bookmarked criterion to the top of its category')   // bookmark PB -> first row in Valuation
it('saves the bookmarked flag in the payload')                 // onSave contains bookmarked: true
it('filters to bookmarked criteria only')                      // chip on -> only PB row visible
it('shows a ribbon marker on bookmarked badges')               // CriteriaPanel
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/CriteriaEditor.test.tsx src/components/__tests__/CriteriaPanel.test.tsx`
Expected: FAIL — no ribbon/toggle/filter.

- [ ] **Step 3: Implement** per interfaces; keep the row order change purely presentational
  (draft array order stays canonical; render sorts a copy). Save persists the flag via
  `onSave`; docs (`FRONTEND.md`) updated in F5.

- [ ] **Step 4: Run to verify pass; commit**

Run: `npx vitest run src/components/__tests__/CriteriaEditor.test.tsx src/components/__tests__/CriteriaPanel.test.tsx && npm run build`

```bash
git add frontend/src/api/types.ts frontend/src/components/CriteriaEditor.tsx frontend/src/components/CriteriaPanel.tsx frontend/src/components/__tests__/CriteriaEditor.test.tsx frontend/src/components/__tests__/CriteriaPanel.test.tsx
git commit -m "feat: criterion bookmarks — ribbon toggle, pinned rows, bookmarked-only filter"
```

---

### Task F7: Ribbon Rail — shared 3D bookmark rail (addendum)

**Files:**
- Create: `frontend/src/components/three/RibbonRail.tsx`,
  `frontend/src/components/three/__tests__/RibbonRail.test.tsx`
- Modify: `frontend/src/components/CriteriaEditor.tsx`, `frontend/DESIGN.md`,
  `frontend/src/index.css` (only if the rail needs a fallback surface)

**Interfaces:**
- `RibbonRail({ items, onSelect }: { items: Array<{ key: string; label: string }>;
  onSelect?: (key: string) => void })` — default export, lazy chunk. One shared canvas: a
  thin glass rail holding one low-poly sakura ribbon per item, label on each ribbon
  (canvas-texture text is acceptable). Bookmark add = ribbon slides in; remove = ribbon
  withdraws — one-shot animation only (no loop; DESIGN.md loop whitelist unchanged); static
  under reduced motion; absent when WebGL is unavailable (no CSS fallback required); hidden
  below `md`. Clicking a ribbon calls `onSelect(key)`.
- `CriteriaEditor` renders it inside `Suspense` at the top of the editor body only while
  open and `items.length > 0`; `onSelect` toggles that row's category open and scrolls the
  row into view.

- [ ] **Step 1: Read the existing 3D pattern first** — `components/three/SakuraLeafLoader.tsx`,
  `lib/webgl.ts`, its test — and mirror gating/static/reduced-motion handling and test hooks.

- [ ] **Step 2: Write the failing tests** — mirror `SakuraLeafLoader.test.tsx`:

```tsx
it('renders nothing without WebGL support')
it('renders one ribbon per item')                        // data-testid="ribbon-rail" + item count hook
it('is static under reduced motion')                     // data-motion="static"
it('calls onSelect when a ribbon is activated')          // click/keyboard fallback button list for a11y
```

- [ ] **Step 3: Implement; run tests; add the DESIGN.md bullet + FRONTEND.md entry (F5 confirms)**

Run: `npx vitest run src/components/three/__tests__/RibbonRail.test.tsx src/components/__tests__/CriteriaEditor.test.tsx && npm run build`
Expected: PASS; build clean; three.js still only in lazy chunks.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/three/RibbonRail.tsx frontend/src/components/three/__tests__/RibbonRail.test.tsx frontend/src/components/CriteriaEditor.tsx frontend/DESIGN.md frontend/src/index.css
git commit -m "feat: 3D ribbon rail for bookmarked criteria"
```

---

### Task F5: Docs + full verification

**Files:**
- Modify: `frontend/FRONTEND.md`

- [ ] **Step 1: Full checks**

```powershell
npm run test
npm run build
rg -n "localhost:8000|#(FFA9C6|0C080B)|CriteriaDialog|UserCriteria" src
```

Expected: tests PASS; build clean; no hardcoded base URLs, palette hex, dialog or
`UserCriteria` references.

- [ ] **Step 2: Update `FRONTEND.md`**

Purpose paragraph (saved screens, inline editor, active screen drives verdicts, per-screen
Top 10), structure entries (`ScreenSetPicker.tsx`, `CriteriaEditor.tsx`; `CriteriaDialog.tsx`
removed), API integration (`/screen/sets*`, retired `/screen/criteria`), phase-gate row
`1.7`.

- [ ] **Step 3: Manual checklist (backend running; mark deferred if unavailable)**

1. Criteria page: picker lists "Default"; create "Quality" → becomes active; badges update.
2. Edit Criteria expands the editor inline; category sub-accordions expand; toggle + threshold
   edits save; no dialog anywhere.
3. Switch screens with unsaved edits → inline Save & switch / Discard & switch bar.
4. Run Screen on the active screen → Top 10 shows only that screen's run; switching screen
   switches the Top 10 (or shows its empty state).
5. Navbar: bar always visible ≥ md; type to search; Ctrl/Cmd+K focuses; Enter opens the stock.
6. `/stocks` verdict chips + stock detail report follow the active screen.

- [ ] **Step 4: Commit**

```bash
git add frontend/FRONTEND.md
git commit -m "docs: frontend context for Phase 1.7 saved screens and navbar search"
```

### Task F8: Chrome-style glass tabs for screens (post-review addendum, 2026-09-29)

**Files:**
- Create: `frontend/src/components/ScreenTabs.tsx`,
  `frontend/src/components/__tests__/ScreenTabs.test.tsx`
- Delete: `frontend/src/components/ScreenSetPicker.tsx`,
  `frontend/src/components/__tests__/ScreenSetPicker.test.tsx`
- Modify: `frontend/src/pages/fundamentals/ScreeningCriteria.tsx`,
  `frontend/src/components/CriteriaPanel.tsx`, `frontend/src/pages/fundamentals/FundamentalsLayout.tsx`,
  `frontend/src/index.css`, `frontend/DESIGN.md`
- Tests: `frontend/src/pages/__tests__/ScreeningCriteria.test.tsx`,
  `frontend/src/pages/__tests__/FundamentalsLayout.test.tsx` (updated)

**Interfaces:**
- `ScreenTabs({ sets, active, dirty, busy, onSelect, onCreate, onRename, onDelete })` —
  role=`tablist` "Screening screens"; one `role="tab"` per set (`aria-selected`); active tab
  glass + sakura glow and merges into the panel below (`rounded-b-none`, `-mb-px`); active
  tab carries `data-dirty` + a sakura dot when the editor draft is dirty; `Close <name>` ×
  opens an inline confirm row under the strip (`Delete <name>?` + Delete/Cancel); pencil
  `Rename <name>` opens an inline input row (`Save name`); `New screen` grows into an inline
  field (`Screen name` + Create); ←/→ move tab focus (roving tabindex), Enter/Space selects;
  horizontal scroll with edge fade (`.tab-strip`).
- `CriteriaPanel` gains `connected?: boolean` (drops top rounding/border to sit under the
  strip) and a `n enabled · n bookmarked` summary; error state gains a `Retry` button wired
  to a new context action `reloadSets`.
- `FundamentalsLayout` context gains `reloadSets: () => Promise<void>` (calls `loadSets`).

- [ ] **Step 1: Write failing tests** — ScreenTabs (render/activate/create/rename/delete
  confirm/keyboard/dirty/error) and update ScreeningCriteria tests (`tab` roles, dirty dot).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the component + CSS (token-derived `.glass-tab`/`.tab-strip`) and
  rewire the page; delete `ScreenSetPicker`.
- [ ] **Step 4: Full checks + commit**

```powershell
npm run test
npm run build
```

```bash
git commit -m "feat: Chrome-style glass screen tabs; criteria page polish"
```

## Acceptance

- `npm run test` green offline; `npm run build` clean; vault-rules green.
- Criteria bookmarks: ribbon toggle per row, bookmarked rows pinned to the top of their
  category, "Bookmarked only" filter, saved/run payloads carry `bookmarked`; read-only
  badges mark bookmarked criteria; the 3D ribbon rail shows one ribbon per bookmark, is
  WebGL-gated, reduced-motion static and never loops.
- No dialog opens in the criteria flow; categories expand/collapse; add/remove/toggle/threshold
  all work; validation blocks bad saves with inline errors.
- Screen CRUD + activate work inline; unsaved drafts never vanish silently; Run executes the
  edited active screen.
- Top 10 is per active screen; empty copy names the screen.
- Navbar search is always visible ≥ md, collapses < md, keyboard-complete.
- Existing Phase 1.6/1.6b/1.6c tests (`Stocks`, `StockDetail`, `ShortlistTable`,
  `GlassNav`, `FundamentalNav`, theme suites) stay green.
