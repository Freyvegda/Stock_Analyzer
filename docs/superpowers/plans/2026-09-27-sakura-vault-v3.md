# Sakura Vault v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method chosen by the owner: native (owner said "start building").

**Goal:** Make the sakura palette the site-wide dark/light identity and replace the flat top nav with a liquid-glass 3D capsule navbar.

**Architecture:** Values swap through the existing single-source token pipeline (`tokens.ts` → synced `index.css` block → Chakra `system.ts`); no architecture change. The navbar becomes one new component (`GlassNav.tsx`) plus token-derived CSS primitives in `index.css`. Login tree/petal scene stays login-only; shell decoration retints through the same tokens.

**Tech Stack:** React 19 + TS, Tailwind v4 (CSS-first), Chakra v3, `motion` (springs, layoutId), vitest + Testing Library, WebGL-free tests.

**Spec:** `docs/superpowers/specs/2026-09-27-sakura-vault-v3-design.md` (all hex values, glass recipe, coverage list live there).

## Global Constraints

- Run frontend commands from `frontend/` (PowerShell). No new dependencies.
- Never hardcode hex or raw palette utility classes in components — `vault-rules.test.ts` gates this; semantic tokens only.
- Gain/loss stay green/red + sign/arrow; sakura never encodes polarity.
- `prefers-reduced-motion: reduce` honoured everywhere; no additions to the decorative loop whitelist.
- `npm run test` and `npm run build` green before each commit. Commit style: `feat:` / `docs:` / `fix:`.
- Every animated component ships a reduced-motion path; tests stay offline (matchMedia is mocked in `src/test/setup.ts`).

## Review Focus

1. Reduced motion: navbar static — no tilt, sheen, or moving pill (Task 4 test).
2. Coarse pointer/touch: tilt + sheen off (`data-tilt="off"`, Task 4 test).
3. Charts + value-flash tints readable in both modes after retint (Task 1 `contrast.test.ts`, Task 3 grep/browse).
4. Dark surfaces must not drift blue (blue − red ≤ 8) or exceed 0.02 luminance (Task 1 `vault-rules.test.ts`).
5. `colorPalette="sakura"` resolves in Chakra — virtual tokens defined, no silent fallback (Task 1 `system.test.ts`, Task 2 build).

---

### Task 1: Sakura palette through the token pipeline

**Files:**
- Modify: `frontend/src/theme/tokens.ts` (both palettes, `amberScale`→`sakuraScale`, `chartPalette`, dark `scenePalette.skyTop`/`star`)
- Modify: `frontend/src/theme/system.ts` (palette rename + virtual tokens)
- Modify: `frontend/src/theme/system.test.ts`
- Modify: `frontend/src/index.css` (only via the sync script)

**Interfaces:**
- Produces: `sakuraScale: Record<number, string>` (replaces `amberScale`; exact steps in spec "Sakura scale"), `dark`/`light: ThemeTokens` with spec values, `chartPalette`, `scenePalette`. `system.ts` registers `colors.sakura` with virtual tokens `contrast/fg/subtle/muted/emphasized/solid/focusRing/border` so `colorPalette="sakura"` works. All other exports keep their names.

- [ ] **Step 1: Point `system.test.ts` at the sakura scale**

Change the three assertions to `system.token('colors.sakura.400')`, `...sakura.700`, and `colors.sakura.{solid,contrast,subtle,focusRing}`; rename the describe blocks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/theme/system.test.ts`
Expected: FAIL — `colors.sakura.400` undefined.

- [ ] **Step 3: Swap the values in `tokens.ts` and `system.ts`**

Apply the spec's tables exactly: dark/light `ThemeTokens`, rename `amberScale` → `sakuraScale` with the spec's ramp, `chartPalette` values + crosshair, dark `scenePalette.skyTop` `#0B0710` and `star` `#E7DCE8`. In `system.ts`, register `colors: { sakura }` and redefine the virtual tokens for `sakura` (tint strengths from the spec; `fg` light = `{colors.sakura.800}`, dark = `{colors.sakura.300}`; `border` light = 600, dark = 500). Update the file comments that still say "amber".

- [ ] **Step 4: Regenerate the synced CSS block**

Run: `$env:VAULT_SYNC='1'; npm run tokens:sync`
Expected: PASS, and `src/index.css` marked block now holds the new values.

- [ ] **Step 5: Run the theme suite and the full suite**

Run: `npm run test`
Expected: PASS — `contrast`, `vault-rules`, `scene-palette`, `tokens.sync` all green (values were pre-verified against these gates).

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/theme frontend/src/index.css
git commit -m "feat: sakura vault palette through token pipeline"
```

---

### Task 2: Chakra call sites switch to the sakura palette

**Files:**
- Modify: `frontend/src/components/CriteriaPanel.tsx` (2 sites), `frontend/src/components/CriteriaDialog.tsx` (1), `frontend/src/pages/Fundamentals.tsx` (1), `frontend/src/pages/Login.tsx` (1)

**Interfaces:**
- Consumes: Task 1's `colorPalette="sakura"` registration.
- Produces: no new API — `colorPalette="amber"` no longer exists anywhere in `src/`.

- [ ] **Step 1: Replace all five `colorPalette="amber"` with `colorPalette="sakura"`**

- [ ] **Step 2: Audit for leftovers**

Run: `rg "colorPalette=\"amber\"|amberScale" frontend/src`
Expected: no matches (test files may mention `sakura` only).

- [ ] **Step 3: Run tests and build**

Run: `npm run test` then `npm run build`
Expected: PASS, build clean.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src
git commit -m "feat: switch chakra call sites to sakura palette"
```

---

### Task 3: Shell decoration retints to sakura

**Files:**
- Modify: `frontend/src/index.css` (`.vault-backdrop` both modes, `[data-flash='neutral']`, `.vault-pulse` + its box-shadow)
- Modify: comments only: `frontend/src/components/Backdrop.tsx`, `frontend/src/components/three/AmbientField.tsx`, `frontend/src/components/three/MarketRingLoader.tsx`

**Interfaces:**
- Consumes: nothing new; keeps the existing class names (`vault-backdrop`, `vault-pulse`, `vault-petal`, `vault-skeleton`) so `Backdrop.test.tsx` and friends stay valid.
- Produces: no JS API change.

- [ ] **Step 1: Retint the three CSS spots** (spec section "Background & surface coverage", items 1–3; keep alpha/blur structure, swap hues)

- [ ] **Step 2: Sweep stale amber wording**

Run: `rg -i "amber" frontend/src frontend/DESIGN.md frontend/FRONTEND.md`
Expected: only `vault-rules.test.ts`'s palette-utility regex and archival mentions in comments that describe history — update every comment that presents amber as the current brand.

- [ ] **Step 3: Verify**

Run: `npm run test` then `npm run build`
Expected: PASS, build clean. Manual check while running `npm run dev`: dark + light backgrounds, run-button flash, no-WebGL pulse ring.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src
git commit -m "feat: retint shell backdrop, flash and pulse to sakura"
```

---

### Task 4: Liquid-glass 3D navbar

**Files:**
- Create: `frontend/src/components/GlassNav.tsx`
- Create: `frontend/src/components/__tests__/GlassNav.test.tsx`
- Modify: `frontend/src/index.css` (add `.glass-nav`, `.glass-nav::after`, `.glass-nav-pill`, `.glass-nav-tilt` + reduced-motion variants)
- Modify: `frontend/src/App.tsx` (replace the inline `<nav>`; drop now-unused `useAuth`/`reduced`/`NavLink`/`IconButton`/`Text`/`LogOut`/`TrendingUp`/`ThemeToggle` imports from `App.tsx` as the compiler confirms)

**Interfaces:**
- Produces: `export function GlassNav()` — no props; reads `useAuth()` (`user`, `logout`), `usePrefersReducedMotion()`, and renders `ThemeToggle`. Capsule element carries `data-testid="glass-nav"` and `data-tilt="on|off"`. Active pill carries `data-testid="glass-nav-pill"` and `aria-hidden="true"`. `navItems` keeps the three routes `'/'`, `'/documents'`, `'/backtest'` and labels.
- Consumes: Task 1 tokens; Task 3 CSS conventions.

- [ ] **Step 1: Write the failing test**

`GlassNav.test.tsx`, following `ThemeToggle.test.tsx`/`RequireAuth.test.tsx` patterns for providers and mocks:

```tsx
// active link: render at '/documents' inside MemoryRouter
expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('aria-current', 'page')
expect(screen.getByTestId('glass-nav-pill')).toBeInTheDocument()
// exactly one pill, inside the active link
expect(screen.getAllByTestId('glass-nav-pill')).toHaveLength(1)

// reduced motion: mock usePrefersReducedMotion -> true
expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-tilt', 'off')

// default jsdom: matchMedia reports no fine pointer
expect(screen.getByTestId('glass-nav')).toHaveAttribute('data-tilt', 'off')

// affordances
expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Color mode' })).toBeInTheDocument()
expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/components/__tests__/GlassNav.test.tsx`
Expected: FAIL — module `GlassNav` not found.

- [ ] **Step 3: Add the CSS primitives to `index.css`**

Spec section "Liquid-glass 3D navbar": `.glass-nav` (token-derived gradient, 1px border, blur/saturate, inset highlight + soft drop), `.glass-nav::after` radial sheen driven by `--sheen-x/--sheen-y/--sheen-opacity`, `.glass-nav-pill` (primary tint 12%, border 30%, soft glow), `.glass-nav-tilt { perspective: 900px; }`; all animation/transition disabled under `prefers-reduced-motion: reduce`. No hex.

- [ ] **Step 4: Implement `GlassNav.tsx`**

Spec structure + behaviour: sticky wrapper, glass capsule, brand, three `NavLink`s, username (`hidden sm:block`), logout, `ThemeToggle`; `useMotionValue`/`useSpring` tilt (±3°) only when `usePrefersReducedMotion()` is false **and** `window.matchMedia('(pointer: fine)').matches`; pointer move writes `--sheen-x/--sheen-y/--sheen-opacity` on the capsule ref; entrance fade/rise/blur 320ms `--ease-vault`; active pill `motion.span` with `layoutId="nav-active-pill"`, static span under reduced motion. `data-tilt` reflects the enable state.

- [ ] **Step 5: Wire into `App.tsx`**

Replace the `<nav>` block with `<GlassNav />`; keep `StatusRail` and `<main className="p-6">`; remove imports that become unused (build is the check).

- [ ] **Step 6: Run tests and build**

Run: `npm run test` then `npm run build`
Expected: PASS, build clean, no unused-import errors.

- [ ] **Step 7: Commit**

```powershell
git add frontend/src
git commit -m "feat: liquid-glass 3d capsule navbar"
```

---

### Task 5: Design contract docs

**Files:**
- Modify: `frontend/DESIGN.md` (palette tables → sakura; nav active signature → pill; glass surface exception; Sakura Garden section: tree stays login-only, pink no longer scene-only; loop whitelist wording; backdrop/motion wording)
- Modify: `frontend/FRONTEND.md` (theming bullet: tokens v3; structure listing: add `GlassNav.tsx`)
- Modify: root `AGENTS.md` only if it names the old theme identity (check first)

**Interfaces:**
- Consumes: everything above; documents exactly what shipped.

- [ ] **Step 1: Rewrite the DESIGN.md palette + navbar + Sakura Garden sections from the spec** (no code values invented; copy spec tables)

- [ ] **Step 2: Update FRONTEND.md theming/structure bullets**

- [ ] **Step 3: Refresh the knowledge graph and verify**

Run: `graphify update .` (repo root), `npm run test`, `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add frontend/DESIGN.md frontend/FRONTEND.md AGENTS.md plan
git commit -m "docs: sakura vault v3 design contract"
```

---

### Task 6: Final verification pass

**Files:** none new — this task may produce small fixes in files above.

- [ ] **Step 1: Full gates**

Run from `frontend/`: `npm run test`, `npm run build`, `npm run lint`
Expected: all clean.

- [ ] **Step 2: Grep audit**

Run: `rg -n "FFB454|B45309|255, 180, 84|180, 83, 9|colorPalette=\"amber\"" frontend/src`
Expected: no matches outside test fixtures that intentionally keep history (if any, fix them).

- [ ] **Step 3: Visual smoke (dev server)**

Run: `npm run dev`, then in both colour modes check: background/card/popover ladder, run-button, criteria dialog, status rail, login scene, navbar tilt + sheen + active pill, reduced-motion emulation off/on.

- [ ] **Step 4: Commit any fixes**

```powershell
git add frontend/src frontend/DESIGN.md
git commit -m "fix: sakura vault review pass"
```
