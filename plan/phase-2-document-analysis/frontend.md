# Phase 2 — Document Analysis (Frontend)

> Read `frontend/FRONTEND.md` first. Endpoints: `plan/phase-2-document-analysis/backend.md`.

## Goal

`Documents.tsx`: pick a shortlisted stock → fetch/parse/analyze controls → document list with AI summary cards.

## Layout

### Stock tabs (shadcn `tabs`)
- On mount: `GET /screen/latest` → one tab per shortlisted symbol. Active tab drives all calls below.

### Action bar (per active stock)
- `Fetch Docs` → `POST /docs/fetch` (body `{symbol}` — if endpoint is global, filter client-side; prefer adding optional `?symbol=` query param when implementing backend).
- `Analyze` → `POST /docs/analyze`. Both show busy states; results refresh list.

### Document list (shadcn `card` per doc)
- Header: type badge (`concall` / `results` / `presentation` / `audit`) + period + parse status badge (`pending` gray, `parsed` green, `failed` red).
- Body (when analysis exists):
  - Sentiment: colored badge — positive green (>0.2), negative red (<-0.2), neutral zinc.
  - `method` badge: `gemini` blue / `fallback` amber — user must see when AI degraded.
  - Summary paragraph, Guidance section, Red flags list (red text, bullet per flag).
- Footer: link to source `url` (opens new tab). Local file not served — link to origin.

### Summary line
- Top of list: `n documents · m analyzed · k fallback · j failed-parse`.

## Types (extend `src/api/types.ts`)

```ts
export interface DocAnalysisDTO { method: 'gemini' | 'fallback'; sentiment: number | null;
  guidance: string | null; red_flags: string[]; summary: string | null }
export interface DocumentDTO { id: number; symbol: string; type: 'concall' | 'results' | 'presentation' | 'audit';
  period: string | null; url: string | null; parse_status: 'pending' | 'parsed' | 'failed';
  analysis?: DocAnalysisDTO | null }
```

## Tests (vitest)

- Sentiment badge thresholds (0.2 / -0.2 boundaries).
- Summary-line counter pure function.

## Acceptance

- Full loop on one stock: Fetch → docs appear (pending) → Analyze → cards show summaries + badges.
- Fallback analysis visibly distinguished (amber badge).
- `npm run build` clean.
