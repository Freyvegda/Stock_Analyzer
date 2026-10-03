# AGENTS.md — Stock Analyzer

## Read First (mandatory before ANY build work)

Before writing or changing code in this repo, in this order:

1. **Graphify knowledge graph** — `graphify-out/graph.json` + `graphify-out/GRAPH_REPORT.md` (code structure, communities, dependencies). Query helpers:
   - `graphify explain "<node>"` — what a node is + neighbors
   - `graphify path "A" "B"` — how two modules connect
   - After changing code: `graphify update .` to refresh the graph
2. **`plan/`** — phase-wise plans. Work ONLY inside the current phase folder (`phase-1-fundamental-screen/`, `phase-1.5/`, `phase-1.6-stock-detail/`, `phase-1.6b-universe-search/`, `phase-1.7/`, `phase-1.8/`, `phase-1.8-run-performance/`, `phase-2-document-analysis/`, `phase-3-price-model/`, `phase-4-backtest/`). Each has `backend.md`, `frontend.md`, `database.md` — read all three for the phase.
3. **Layer context files** — `backend/BACKEND.md`, `frontend/FRONTEND.md`, `backend/app/db/DATABASE.md`. Architectural rules there are binding.
4. **`PLAN.md`** (root) — overall design, locked decisions, cost constraints.

If plan files and existing code disagree, code wins — then update the plan file in the same change.

## Project

Personal Nifty 500 analysis tool. Pipeline: fundamental screen (per-user DB criteria) → AI doc analysis (Gemini Flash free tier + fallback) → XGBoost signals → walk-forward backtest. Budget ₹0. Details: `PLAN.md`.

## Commands

```powershell
# backend (from backend/, venv active)
pip install --isolated <pkg>          # REQUIRED: user pip.ini has broken NVIDIA extra-index
uvicorn app.main:app --reload
.\.venv\Scripts\python.exe -m pytest tests -q

# frontend (from frontend/)
npm run dev
npm run build                          # must stay clean (tsc -b && vite build)
npx shadcn@latest add <component>

# knowledge graph
graphify update .
```

## Hard Rules

- DataProvider interface for all external data; Model interface for all price models. No bypassing.
- Composite PKs = idempotent reruns everywhere.
- Per-stock failure isolation — one failure never kills a batch.
- Tests run offline; mock all network.
- Tests + build green before committing.
