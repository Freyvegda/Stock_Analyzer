# Phase 1.5 — Frontend (login gate, criteria dialog, stair-tower loader)

> **For agentic workers:** part of the Phase 1.5 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-09-26-phase-1.5-authorization-db-screener-design.md`.
> Backend contract: `plan/phase-1.5-authorization-db-screener/backend.md`.
> Design contract: `frontend/DESIGN.md`.

**Goal:** gate the app behind login (setup on first run), replace the YAML criteria panel with
an animated Edit Criteria dialog driving `PUT /screen/criteria`, and ship the pure-CSS
never-ending-tower loader.

**Architecture:** `AuthContext` + `RequireAuth` wrap the existing shell; `Login.tsx` handles
setup/login; `api/client.ts` gains `put` and emits `auth:unauthorized` on 401.
`CriteriaDialog.tsx` (Chakra Dialog + motion) edits criteria rows fed by `GET /screen/ratios`.
`StairTowerLoader` + `stair-tower.css` replace the Three.js `RunVisual`.

**Tech stack:** React 19, TS, Vite, Chakra UI v3, motion, Tailwind/shadcn, vitest + jsdom +
Testing Library. **No new dependencies.**

## Global Constraints

- Work dir: `frontend/`. Tests: `npm run test`. Build: `npm run build` (must stay clean).
- Tests run offline; mock `api`, `fetch`, WebGL, matchMedia.
- `frontend/DESIGN.md` binds: emerald tokens only, Geist, `tabular-nums` on numbers,
  lucide-react icons only (16px, `strokeWidth={1.75}`, `aria-hidden` decorative,
  `aria-label` icon-only buttons), durations 150/220/320 ms.
- All animation honors `prefers-reduced-motion`; the loader is the single sanctioned looping
  animation and is never placed inside tables/summaries.
- Semantic tokens only (`bg-background`, `text-muted-foreground`, `border-border`, `bg`, `fg.muted`,
  `brand`) — no raw palette classes.
- API shapes come from `src/api/types.ts`.
- Summary line copy stays exactly: `${shortlisted} shortlisted · ${failed} failed · ${total} total`.
- `tsconfig` rules: `verbatimModuleSyntax` (`import type`), no enums, no parameter properties,
  `noUnusedLocals`.

## Review Focus

1. Session expires mid-session (any API 401) → user lands on `/login`, loader stops, no crash/loop — Task F4 test `redirects to login after any 401`.
2. Two-tab setup race → 409 switches the card to login instead of dead-ending — Task F3 test `switches to login card on 409`.
3. `GET /screen/criteria` fails on dialog open → inline error + Retry, dialog never blank — Task F6 test `shows error and retries when criteria load fails`.
4. Loader under reduced motion → static pose, still announced via `role="status"` — Task F5 test `renders static structure under reduced motion`.
5. Disabled criteria are never shown as active badges and never sent as enabled — Task F7 test `panel badges show only enabled criteria`.

---

### Task F1: API client `put` + 401 event + Phase 1.5 types

**Files:**
- Modify: `frontend/src/api/client.ts`, `frontend/src/api/types.ts`
- Test: `frontend/src/api/__tests__/client.test.ts` (extend)

**Interfaces:**
- Produces: `api.put<T>(path, body) => Promise<T>`; on any non-`/auth/*` response with
  `status === 401` the client dispatches `window.dispatchEvent(new Event('auth:unauthorized'))`
  before throwing `ApiError`. Types `AuthUser{id, username}`, `Criterion{key, enabled, value}`,
  `UserCriteria{criteria: Criterion[], thesis: string | null, shortlist_size: number}`,
  `RatioSpec{key, label, unit, category, direction: 'min' | 'max'}`.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends PUT with a JSON body', async () => { /* mock fetch ok; expect method PUT + body */ })
it('dispatches auth:unauthorized on 401', async () => { /* spy event; GET '/screen/latest' 401 */ })
it('does not dispatch for 401 from /auth/me', async () => { /* path startsWith '/auth/' */ })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/api/__tests__/client.test.ts`
Expected: FAIL — `api.put` undefined.

- [ ] **Step 3: Implement**

`request<T>(path, init)` stays; add the 401 branch before throwing. `api.put` mirrors `post`.
Types appended to `types.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/api/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/types.ts frontend/src/api/__tests__/client.test.ts
git commit -m "feat: api.put, auth:unauthorized event on 401, Phase 1.5 API types"
```

---

### Task F2: AuthContext + RequireAuth

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`, `frontend/src/components/RequireAuth.tsx`
- Test: `frontend/src/auth/__tests__/AuthContext.test.tsx`

**Interfaces:**
- Produces: `useAuth(): {user: AuthUser | null, loading: boolean, refresh(): Promise<void>, logout(): Promise<void>}`;
  `<AuthProvider>`; `<RequireAuth>{children}</RequireAuth>` → `<Navigate to="/login" replace />`
  when `!loading && !user`, `null` while loading, children otherwise.

- [ ] **Step 1: Write failing tests**

```tsx
it('loads the current user from /auth/me')          // api.get mock resolves user
it('treats 401 as anonymous without an error state') // ApiError status 401
it('clears the user when auth:unauthorized fires')   // dispatch window event inside act
it('logout posts and clears the user')               // api.post('/auth/logout') then user null
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/auth/__tests__/AuthContext.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`AuthProvider`: `useEffect` → `api.get<AuthUser>('/auth/me')` (401 → `setUser(null)`),
listener for `auth:unauthorized` on `window`, cleanup removes it. `logout` → `api.post('/auth/logout', {})`
in `try/finally` set user null. Import `AuthUser` via `import type`.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/auth/__tests__/AuthContext.test.tsx` → PASS.

```bash
git add frontend/src/auth frontend/src/components/RequireAuth.tsx
git commit -m "feat: auth context and protected route wrapper"
```

---

### Task F3: Login page (setup + login cards)

**Files:**
- Create: `frontend/src/pages/Login.tsx`
- Test: `frontend/src/pages/__tests__/Login.test.tsx`

**Interfaces:**
- Consumes: F1 `api`, F2 `useAuth`, F5 loader (tasks F5/F3 are independent; if F5 not merged
  yet, render a plain submit button and swap in the loader when F5 lands).
- Produces: `/login` page behavior per spec: `GET /auth/state` mounts → `users_exist` false =
  Create account card, else Login card; success → `refresh()` + `navigate('/')`;
  409 → switch to login card with "Account already exists"; validation inline.

- [ ] **Step 1: Write failing tests**

```tsx
it('shows the create-account card when no users exist')
it('shows the login card when a user exists')
it('validates password confirmation locally')         // 'Passwords do not match', no api call
it('switches to login card on 409')
it('renders server errors inline')                    // 401 detail in role="alert"
it('navigates after successful login')                // mocked useNavigate/refresh
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/__tests__/Login.test.tsx` → FAIL (missing module).

- [ ] **Step 3: Implement**

Chakra `Card`-style `Box` centered; fields with labels; client rules: username 3–32,
password ≥ 8, confirm match; `type="password"`; submit disabled while pending; errors in
`role="alert"`; toast on success via `toaster`. Use semantic tokens; no hardcoded palette.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/pages/__tests__/Login.test.tsx` → PASS.

```bash
git add frontend/src/pages/Login.tsx frontend/src/pages/__tests__/Login.test.tsx
git commit -m "feat: first-run setup and login page"
```

---

### Task F4: Route restructure — public login, protected shell

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Test: `frontend/src/__tests__/App.test.tsx` (create)

**Interfaces:**
- Consumes: F2 `AuthProvider`, `RequireAuth`, `AuthContext`; F3 `Login`.
- Produces: `/login` public; `/`, `/documents`, `/backtest` inside `<RequireAuth>` with the
  existing nav shell + ThemeToggle + `AmbientField` + `Toaster`.

- [ ] **Step 1: Write failing tests**

```tsx
it('redirects anonymous users to the login page')   // mock api /auth/me 401; render <App/> in MemoryRouter
it('renders the shell for an authenticated user')   // /auth/me 200 -> nav + Fundamentals
it('redirects to login after any 401')              // dispatch auth:unauthorized while on '/'
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/App.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`main.tsx`: wrap `<App/>` in `<AuthProvider>` inside `BrowserRouter`. `App.tsx`: routes split —
`/login` outside the shell; a `Shell` component (current nav + AmbientField + Toaster) wraps
`<RequireAuth><Routes>...</Routes></RequireAuth>`. Keep nav labels unchanged.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/__tests__/App.test.tsx && npm run build` → PASS + clean.

```bash
git add frontend/src/App.tsx frontend/src/main.tsx frontend/src/__tests__/App.test.tsx
git commit -m "feat: route login publicly and protect the app shell"
```

---

### Task F5: StairTowerLoader (pure CSS never-ending tower)

**Files:**
- Create: `frontend/src/components/ui/StairTowerLoader.tsx`, `frontend/src/components/ui/stair-tower.css`
- Test: `frontend/src/components/__tests__/StairTowerLoader.test.tsx`

**Interfaces:**
- Produces: `StairTowerLoader({ size = 120, label = 'Loading…', className }: {size?: number; label?: string; className?: string})`
  — root `role="status"` + `aria-live="polite"`, sr-only label text, `data-testid="stair-tower-loader"`,
  8 elements `data-testid="tower-step"`, 1 `data-testid="tower-dot"`, wrapper sets
  `style={{ '--tower-size': `${size}px` }}`.

- [ ] **Step 1: Write failing tests**

```tsx
it('renders an announced loading status')          // role="status" + label text
it('renders eight steps and one dot')
it('renders static structure under reduced motion') // mock matchMedia matches=true; same DOM; no throw
it('scales via the --tower-size custom property')   // style attribute contains e.g. 20px
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/StairTowerLoader.test.tsx` → FAIL.

- [ ] **Step 3: Implement component + CSS**

- TSX: imports `'./stair-tower.css'`; maps 8 step spans with alternating column classes
  (`tower-step--left/right`) and per-step delay via `style={{ animationDelay: \`${-0.4 * i}s\` }}`;
  dot inside a wrapper span for the zig-zag X animation.
- CSS: `--tower-size` drives every dimension (`width: calc(var(--tower-size) * 0.28)` etc.);
  steps keyframes spawn top (`opacity 0 → 1`, `translateY(-8%)`) → fall bottom
  (`opacity 1 → 0`, `translateY(105%)`), duration `3.2s linear infinite`; dot
  `lift` bottom→top over 3.2s + stepped `zig` switching columns every 0.4s (two keyframes,
  `steps(1, end)`); emerald via `var(--primary)` / `var(--chart-1)`. `@media
  (prefers-reduced-motion: reduce) { ... animation: none; }` with a static mid-tower pose.
- No JS animation; no new deps.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/__tests__/StairTowerLoader.test.tsx` → PASS.

```bash
git add frontend/src/components/ui/StairTowerLoader.tsx frontend/src/components/ui/stair-tower.css frontend/src/components/__tests__/StairTowerLoader.test.tsx
git commit -m "feat: pure-CSS never-ending stair tower loader"
```

---

### Task F6: CriteriaDialog (animated edit subwindow)

**Files:**
- Create: `frontend/src/components/CriteriaDialog.tsx`
- Test: `frontend/src/components/__tests__/CriteriaDialog.test.tsx`

**Interfaces:**
- Consumes: F1 (`api`, types), F5 (`StairTowerLoader`).
- Produces: `CriteriaDialog({ open, onOpenChange, initial, onSaved }: {open: boolean; onOpenChange: (open: boolean) => void; initial: UserCriteria; onSaved: (next: UserCriteria) => void})`.
  - Loads `GET /screen/ratios` once per open; Combobox adds catalog entries not already present.
  - Save → `PUT /screen/criteria` with `{criteria: [{key, enabled, value}...], thesis}` in the
    dialog's row order; success → `onSaved(saved)` + close; failure → inline error.
  - Validation mirrors API: every row finite numeric, ≥ 1 enabled, thesis ≤ 500.
  - Chakra `Dialog.Root` with `motionPreset="scale"`, scrollable body (`maxH="70vh"`),
    staggered row entrance via `motion` (reduced motion → instant).

- [ ] **Step 1: Write failing tests**

```tsx
it('renders existing criteria rows with direction suffixes')   // PE ≤, ROE ≥
it('toggles a criterion off and dims its row')
it('adds a ratio via the combobox and excludes existing keys')
it('removes a row')
it('sends the exact PUT payload on save')                      // assert body {criteria, thesis}
it('shows server 422 detail inline and keeps the dialog open')
it('blocks save when every criterion is disabled')
it('shows loader inside save while pending')                    // stair-tower-loader present
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/CriteriaDialog.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

Chakra `Dialog.Root`/`Dialog.Backdrop`/`Dialog.Positioner`/`Dialog.Content`; header with
title "Edit Criteria" and close trigger; rows: `Switch` (label `aria-label="Enable <label>"`),
label + unit, direction glyph from `RatioSpec.direction`, numeric `Input` (`type="number"`,
`step="any"`), remove `IconButton` (`aria-label="Remove <label>"`, lucide `Trash2`); "Add ratio"
`Combobox` grouped by `category` with local case-insensitive filter; thesis `Textarea`
(`maxLength={500}` + counter); footer Cancel/Save; save in-flight → small loader; errors:
per-row text + top-level `role="alert"`; `GET /screen/ratios` failure → inline error + Retry.

- [ ] **Step 4: Run to verify pass + commit**

Run: `npx vitest run src/components/__tests__/CriteriaDialog.test.tsx` → PASS.

```bash
git add frontend/src/components/CriteriaDialog.tsx frontend/src/components/__tests__/CriteriaDialog.test.tsx
git commit -m "feat: animated criteria editor dialog with catalog combobox"
```

---

### Task F7: CriteriaPanel rewrite + Fundamentals wiring + delete RunVisual

**Files:**
- Modify: `frontend/src/components/CriteriaPanel.tsx`, `frontend/src/pages/Fundamentals.tsx`,
  `frontend/src/components/__tests__/CriteriaPanel.test.tsx`,
  `frontend/src/pages/__tests__/Fundamentals.test.tsx`
- Delete: `frontend/src/components/three/RunVisual.tsx`,
  `frontend/src/components/three/__tests__/RunVisual.test.tsx`

**Interfaces:**
- Consumes: F1–F6.
- Produces: `CriteriaPanel({ criteria, shortlistSize, onEdit }: {criteria: Criterion[] | null; shortlistSize: number; onEdit: () => void})`
  — badges for enabled criteria only (catalog label + unit fallback `key: value`), read-only
  `Top {shortlistSize}` badge, primary `Edit Criteria` button, error text when `criteria === null`.
  `Fundamentals` loads `GET /screen/criteria`, owns dialog open state, swaps run-card
  `RunVisual` for `<StairTowerLoader size={120} />`, keeps run/latest/empty-state behavior.

- [ ] **Step 1: Update failing tests**

`CriteriaPanel.test.tsx` rewritten:

```tsx
it('renders badges for enabled criteria only')     // disabled key absent
it('renders a read-only Top 10 badge')
it('calls onEdit when Edit Criteria is clicked')
it('shows a fallback label for unknown keys')      // 'custom_ratio: 3'
```

`Fundamentals.test.tsx` updates: `/screen/config` mocks → `/screen/criteria`; assert
`POST /screen/run` + `/screen/latest` unchanged; assert the tower loader shows while running;
assert a 401 on mount redirects (via mocked AuthContext or `auth:unauthorized`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/CriteriaPanel.test.tsx src/pages/__tests__/Fundamentals.test.tsx`
Expected: FAIL — props/endpoints changed.

- [ ] **Step 3: Implement**

- Panel: Chakra `Wrap` of `Badge`s from `criteria.filter(c => c.enabled)`; human labels come
  from a small `LABELS` map for the six derived keys + raw `key` fallback; "Edit Criteria"
  `Button colorPalette="emerald"`; remove reload button, YAML hint, `config` prop.
- Fundamentals: replace `ScreenConfig`/`loadConfig`/`reloadConfig` with
  `UserCriteria`/`loadCriteria`; `criteria`/`shortlistSize` state; dialog open state + `onSaved`
  updates state; running card renders `StairTowerLoader` (no `lazy`, no `Suspense`).
- Delete `RunVisual.tsx` + test; confirm no other imports
  (`rg -n "RunVisual" frontend/src` → empty).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test` → PASS; `npm run build` → clean (three must appear only in the
`AmbientField` chunk).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat: DB-driven criteria panel, dialog wiring, stair-tower run loader; drop RunVisual"
```

---

### Task F8: Docs + full verification

**Files:**
- Modify: `frontend/FRONTEND.md`, `frontend/DESIGN.md`

- [ ] **Step 1: Full checks**

```powershell
npm run test
npm run build
rg -n "screening\.yaml|/screen/config|RunVisual" src
```
Expected: tests PASS; build clean; grep empty.

- [ ] **Step 2: Update docs**

FRONTEND.md: auth flow (AuthContext/RequireAuth/Login), criteria dialog, loader, new test
files, `/login` route. DESIGN.md: add the loader exception under Motion (one sanctioned
looping animation; never inside data areas; reduced-motion static pose).

- [ ] **Step 3: Manual checklist (needs backend running; mark deferred if unavailable)**

1. Anonymous visit → `/login`; setup card on empty DB; login works; reload keeps session.
2. Logout returns to login; back-button doesn't re-enter the app.
3. Edit Criteria: add/remove/toggle/thesis; save; reopen shows saved state.
4. Run card shows the tower; run completes; summary + table unaffected.
5. Reduced motion (OS setting): loader static, dialog instant, no layout shift.

- [ ] **Step 4: Commit**

```bash
git add frontend/FRONTEND.md frontend/DESIGN.md
git commit -m "docs: frontend context and design contract for Phase 1.5"
```

## Acceptance

- `npm run test` green offline; `npm run build` clean; three.js only in the `AmbientField` chunk.
- Anonymous users can reach only `/login`; 401 anywhere else lands on `/login` exactly once.
- Criteria edit round-trips through `PUT /screen/criteria`; panel badges update without reload;
  disabled criteria never render as badges and are sent with `enabled: false`.
- `shortlist_size` never appears in any request body; `Top 10` is display-only.
- Tower loader animates in the run card; static under reduced motion; announced via `role="status"`.
- No references to `screening.yaml`, `/screen/config*`, or `RunVisual` remain in `frontend/src`.
