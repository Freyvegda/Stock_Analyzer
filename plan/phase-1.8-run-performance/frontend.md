# Phase 1.8 — Run performance (frontend: instant run + progress panel)

> **For agentic workers:** part of the Phase 1.8 plan. Required sub-skill when executing:
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use
> checkbox (`- [ ]`) syntax.
>
> **Spec:** `docs/superpowers/specs/2026-10-03-run-performance-design.md`.
> Backend contract: `plan/phase-1.8-run-performance/backend.md` (B6). Schema:
> `plan/phase-1.8-run-performance/database.md`.

**Goal:** Run shows the cached shortlist instantly, a per-screen progress panel + universe
counter track the background job live (surviving page reloads), busy screens are locked in
the UI, and Top 10 auto-refreshes to the refined run when the job completes.

**Architecture:** `FundamentalsLayout` keeps owning run state; it gains `job` state, a 2 s
`/screen/jobs/latest` poll while the job runs, and a mount-time jobs fetch so reloads
restore progress. New `components/RunProgress.tsx` is presentation-only. `ScreenTabs`,
`CriteriaPanel`, `CriteriaEditor` gain passive "busy/locked" props; no dialogs.

**Tech stack:** React 19, TypeScript, Vite, Chakra UI v3 (status/interactive), Tailwind
(shell). vitest + Testing Library. No new dependencies.

## Global Constraints

- Work dir: `frontend/`. Verify: `npm run test` and `npm run build` (must stay clean).
- All tests mock the `api` module (`vi.mock('../../api/client')`) as in
  `src/pages/__tests__/TopTen.test.tsx`; no real network, no WebGL chunk.
- DESIGN.md rules: Chakra for status/interactive, Geist Mono via `Num` for every number,
  no hardcoded palette classes/hex (vault-rules test enforces), no new motion loops — the
  running chip reuses the existing `vault-pulse` class, no new keyframes.
- Response shapes from B6: `POST /screen/run -> {run, job}`;
  `GET /screen/jobs/latest -> {job | null}`.
- Poll cadence 2 s; stop on `done|failed|interrupted`; clear on unmount.

## Review Focus

Failure modes most likely to bite; each has a test in the task that owns the code.

1. Page reload mid-job restores the progress panel instead of pretending no run exists —
   F2 `test_mount_restores_running_job_progress`.
2. Completion triggers exactly one `/screen/latest` refresh, never a poll loop — F2
   `test_done_poll_refreshes_latest_once_and_stops`.
3. Failed/interrupted job keeps the cached rows and warns — F2 `test_failed_poll_keeps_rows_and_toasts`.
4. A busy screen cannot be edited, renamed, deleted, or activated from the UI — F3 tests.
5. Layout-mounting tests must mock the new `/screen/jobs/latest` call or they reject the
   unexpected path — F2 Step 1 updates every existing mount mock.

---

### Task F1: Job types + `RunProgress` component

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/components/RunProgress.tsx`
- Create: `frontend/src/components/__tests__/RunProgress.test.tsx`

**Interfaces:**
- Produces in `api/types.ts`:

```ts
export type RunJobStatus = 'running' | 'done' | 'failed' | 'interrupted'
export type RunJobItemStatus = 'queued' | 'running' | 'done' | 'failed'
export interface RunJobItem {
  set_id: number
  name: string
  status: RunJobItemStatus
  run_id: number | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}
export interface RunJob {
  id: number
  set_id: number
  status: RunJobStatus
  started_at: string
  finished_at: string | null
  error: string | null
  universe_total: number
  universe_done: number
  universe_failed: number
  items: RunJobItem[]
}
export interface RunResponse {
  run: ScreenRunResult
  job: RunJob
}
export interface JobsLatestResponse {
  job: RunJob | null
}
```

- Produces `RunProgress({ job }: { job: RunJob })` rendering:
  - screen chips in `job.items` order (backend sends active first): `data-testid={`job-chip-${item.set_id}`}`, label `item.name` (fallback `Screen {set_id}` when empty), status word (`queued` / `running` + elapsed for `running` / `done` / `failed` + `item.error` in a `title` attribute). Running chips get the existing `vault-pulse` class.
  - universe counter `data-testid="job-universe-counter"`: `Num` formatted `done+failed / total` + `· N failed` (only when failed > 0).
  - thin progress bar (`role="progressbar"`, `aria-valuenow={done + failed}`, `aria-valuemax={total}`).
  - job status banner `data-testid="job-status"` for non-running statuses: `done` renders "Refreshed N/M"; `failed` renders `job.error`; `interrupted` renders "Interrupted — run again" with `data-testid="job-rerun-hint"`.
- Elapsed helper: `export function chipElapsed(item: RunJobItem, now: number): number | null` — seconds since `item.started_at` while `running`, `null` otherwise (unit-testable; `formatElapsed` from `@/lib/format` renders it).

- [ ] **Step 1: Write the failing test** — create `frontend/src/components/__tests__/RunProgress.test.tsx`

```tsx
// job with items: [set 1 running started_at fixed, set 2 queued, set 3 failed error "boom"]
// -> chips render in order; "job-universe-counter" shows "3 / 10" plus "· 2 failed";
// progressbar aria-valuenow == 3; "job-chip-3" exposes title "boom"
// -> interrupted job renders "Interrupted — run again"
// -> chipElapsed returns null for queued/done, seconds for running
```

Wrap renders in `<Provider>` from `@/components/ui/provider` (Chakra context).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- RunProgress`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `types.ts` additions + `RunProgress.tsx`**

Use `Badge`, `Flex`, `Text`, `Box`, Chakra components only; numbers inside `Num` from
`@/components/ui/Num`; elapsed ticks locally with a 1 s `setInterval` only while at least
one item is `running` (no interval otherwise).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- RunProgress`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/components/RunProgress.tsx frontend/src/components/__tests__/RunProgress.test.tsx
git commit -m "feat: run job types + per-screen RunProgress panel"
```

---

### Task F2: Layout — job state, polling, instant run flow

**Files:**
- Modify: `frontend/src/pages/fundamentals/FundamentalsLayout.tsx`
- Modify: `frontend/src/pages/__tests__/TopTen.test.tsx` (mock `/screen/jobs/latest`)
- Modify: `frontend/src/pages/__tests__/ScreeningCriteria.test.tsx` (same mock)
- Modify: `frontend/src/pages/__tests__/FundamentalsLayout.test.tsx` (same mock + new
  run-flow cases)

**Interfaces:**
- Modifies `FundamentalsOutletContext` (additive):
  ```ts
  job: RunJob | null
  busySetIds: Set<number>
  stale: boolean
  starting: boolean
  ```
  `running` stays for existing consumers and now means `starting || job?.status === 'running'`.
  `elapsed` stays (total job seconds when a job exists).
- `runScreen()` flow: `setStarting(true)` → `POST /screen/run` typed
  `RunResponse` → `setSummary` from `res.run`, `setStale(res.run.stale ?? false)`,
  `setJob(res.job)`, rows fallback `res.run.shortlisted`, then the existing `/screen/latest`
  enrichment + auto-jump; `finally` clears `starting`. Stale toast on `res.run.stale` stays.
- Poll effect: while `job?.status === 'running'`, `setInterval` 2 s
  `api.get<JobsLatestResponse>('/screen/jobs/latest')`; store the next job; on
  `done` → `void loadLatest()` + `setStale(false)` (once); on `failed|interrupted` → warning
  `toaster.create` and keep cached rows. Interval cleared on unmount/status change.
- Mount effect adds one `/screen/jobs/latest` fetch (restores progress after reload); a
  `running` result starts the poll.
- `busySetIds` = item `set_id`s with `queued|running` while the job is `running`, else empty.

- [ ] **Step 1: Update existing mount mocks, then write the failing tests**

Every test rendering `FundamentalsLayout` (`TopTen.test.tsx`, `ScreeningCriteria.test.tsx`)
adds `if (path === '/screen/jobs/latest') return Promise.resolve({ job: null })` to its
`mockedApi.get` implementation — otherwise the mount fetch rejects.

`FundamentalsLayout.test.tsx` new cases (mock POST + GET sequences):

```tsx
test_run_posts_once_and_shows_cached_results:   // POST resolves {run with rows, job running}
test_mount_restores_running_job_progress:       // GET /screen/jobs/latest -> job running
test_done_poll_refreshes_latest_once_and_stops: // poll -> done; assert GET /screen/latest
                                                // called again and no further poll after
                                                // job status done (advance timers)
test_failed_poll_keeps_rows_and_toasts:         // poll -> failed + error; rows still rendered;
                                                // toaster.create called with error title
```

Use `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(2000)` for the poll; assert
with `findBy*` on progress chips (`job-chip-1`) and rows.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- FundamentalsLayout TopTen ScreeningCriteria`
Expected: FAIL — no `job` state / no poll.

- [ ] **Step 3: Implement in `FundamentalsLayout.tsx`**

Keep one interval ref; never refetch `/screen/latest` more than once per job completion
(track the last completed job id in a ref). Reuse `formatElapsed` for `elapsed` from
`job.started_at` when present, else the current local timer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- FundamentalsLayout TopTen ScreeningCriteria`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/fundamentals/FundamentalsLayout.tsx frontend/src/pages/__tests__
git commit -m "feat: instant run + background job polling in fundamentals layout"
```

---

### Task F3: Busy-screen UI + progress placement + stale badge

**Files:**
- Modify: `frontend/src/components/ScreenTabs.tsx`
- Modify: `frontend/src/components/CriteriaPanel.tsx`
- Modify: `frontend/src/components/CriteriaEditor.tsx`
- Modify: `frontend/src/pages/fundamentals/ScreeningCriteria.tsx`
- Modify: `frontend/src/pages/fundamentals/TopTen.tsx`
- Modify: `frontend/src/pages/__tests__/ScreeningCriteria.test.tsx`
- Modify: `frontend/src/pages/__tests__/TopTen.test.tsx`

**Interfaces:**
- `ScreenTabsProps` gains `busySetIds?: Set<number>` (default empty). A busy tab renders a
  small running dot (`data-testid={`tab-running-${set.id}`}`); its select/rename/delete
  controls are disabled; other tabs behave unchanged.
- `CriteriaPanel` gains `locked?: boolean` (default false): Edit Criteria disabled + a
  `data-testid="panel-locked"` note "Screen is running — editing unlocks when the job
  finishes."
- `CriteriaEditorProps` gains `disabled?: boolean` (default false): all inputs/buttons
  disabled; `save()` resolves `false` when disabled (guard, even though Edit is locked).
- `ScreeningCriteria`: passes `busySetIds` to `ScreenTabs`, `locked` to `CriteriaPanel` and
  `disabled` to `CriteriaEditor` (active set busy). Run card renders `<RunProgress job={job}/>`
  when `job !== null`, above the loader; the loader block stays only while `starting`.
- `TopTen`: renders `<RunProgress job={job}/>` under the header when a job exists; renders a
  stale badge `data-testid="stale-badge"` with text "cached — refreshing in background" when
  `stale` is true. The "Screen run in progress — results appear here when it finishes." line
  is replaced by the progress panel.

- [ ] **Step 1: Write the failing tests** — extend `ScreeningCriteria.test.tsx` + `TopTen.test.tsx`

```tsx
test_busy_active_screen_locks_editor:      // job running with active item running ->
                                           // Edit Criteria disabled, panel-locked visible,
                                           // rename/delete controls disabled
test_run_button_disabled_while_job_running:
test_top10_shows_progress_and_stale_badge: // stale true -> stale-badge; job -> chip visible
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- ScreeningCriteria TopTen`
Expected: FAIL.

- [ ] **Step 3: Implement the props and placement**

Follow DESIGN.md: lock note in `fg.muted`; dot uses `vault-pulse`; no new keyframes; numbers
in `Num`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- ScreeningCriteria TopTen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components frontend/src/pages/fundamentals frontend/src/pages/__tests__
git commit -m "feat: busy-screen locks, progress panel placement, stale badge"
```

---

### Task F4: Docs + full frontend verification

**Files:**
- Modify: `frontend/FRONTEND.md` (run state: instant cached run, `RunProgress`, 2 s poll,
  busy-screen locks; API contract additions)

- [ ] **Step 1: Update `FRONTEND.md`** with the shipped run flow and new endpoint shapes.

- [ ] **Step 2: Full frontend verification**

Run: `npm run test`
Expected: all suites green.

Run: `npm run build`
Expected: clean (`tsc -b && vite build`).

- [ ] **Step 3: Commit**

```bash
git add frontend/FRONTEND.md
git commit -m "docs: Phase 1.8 frontend run flow"
```

## Acceptance

- Run paints the cached shortlist in seconds; the progress panel shows per-screen chips +
  universe counter and survives a reload.
- Job completion swaps Top 10 to the refined run once, without navigation; failure or
  interruption keeps cached rows and warns.
- Busy screens show a running dot and cannot be edited, renamed, deleted, or activated.
- `npm run test` + `npm run build` clean; docs updated; DESIGN loop whitelist untouched.
