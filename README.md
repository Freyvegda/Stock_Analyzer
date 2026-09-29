# Stock Analyzer

Personal Indian-market (Nifty 500) analysis tool. See `PLAN.md` for the full plan.

Pipeline: fundamental screen (per-user DB criteria) → AI document analysis (concalls, results, audits) → XGBoost price signals → walk-forward backtest vs Nifty.

First visit creates the single account (login-gated app); screening criteria are saved as named screens in the UI (per-user `screening_sets`, `/screen/sets`).

## Stack

- **Backend:** Python 3.10, FastAPI, SQLAlchemy + SQLite, yfinance, pdfplumber, XGBoost, Gemini Flash (free tier)
- **Frontend:** React + TypeScript + Vite, shadcn/ui + Tailwind, lightweight-charts + recharts
- **Knowledge graph:** `graphify update .` to index code (graphify-out/)

## Run

```powershell
# backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload   # http://localhost:8000  (GET /health)

# frontend
cd frontend
npm run dev                     # http://localhost:5173
```

## Test

```powershell
cd backend; .\.venv\Scripts\python.exe -m pytest tests -q
cd frontend; npm run test
```

## Config

Screening criteria live in the database as named per-user screens (`screening_sets`; exactly one active) — edit them in the UI (Screen Criteria page) or via `/screen/sets`. The former `backend/config/screening.yaml` was retired in Phase 1.5; the single-criteria `user_criteria` row was retired in Phase 1.7.
