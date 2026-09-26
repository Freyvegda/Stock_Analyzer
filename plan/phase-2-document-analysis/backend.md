# Phase 2 — Document Analysis (Backend)

> Read `backend/BACKEND.md` first. Only runs on Phase 1 shortlist — never the full 500.

## Goal

For each shortlisted stock: find concall transcripts, quarterly results, investor presentations, audit/annual report PDFs → download → parse → Gemini Flash analysis (keyword fallback) → `doc_analysis` rows.

## Tasks

1. **`data/nse_impl.py`** — `filings(symbol)` implementation:
   - NSE corporate announcements: `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol={symbol}` (httpx; needs headers `User-Agent`, `Accept-Language`, cookie bootstrap via GET `https://www.nseindia.com` first — yfinance's curl_cffi session pattern also works).
   - Filter `desc`/`attchmntText` for keywords: transcript, concall, earnings call, results, investor presentation, annual report.
   - Return `[{type, period, url}]` — classify `type` by keyword map; `period` from text regex `(Q[1-4]\s?FY\d{2}|FY\d{2})`.
   - Fallback source: BSE `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w` if NSE blocks.

2. **`docs/fetcher.py`**:
   - `fetch(symbol, filings) -> list[Document]`: download each PDF (httpx stream, max 50MB) to `data/docs/{symbol}/{type}_{period}.pdf`; insert `documents` row `parse_status=pending`; skip if `local_path` file already exists (idempotent).

3. **`docs/parser.py`**:
   - `extract_text(path) -> str`: pdfplumber page loop; cap at 200 pages. Empty/garbage (<200 chars) → raise `ParseError`; caller sets `parse_status=failed`, continues.

4. **`docs/analyzer.py`**:
   - `analyze(text) -> dict`: prompt Gemini Flash (`gemini-2.0-flash` via google-generativeai, `GEMINI_API_KEY` env var) asking for strict JSON: `{sentiment: -1..1, guidance: str, red_flags: [str], summary: str}`. Truncate input ~30k chars (free tier).
   - Rate limit / exception / missing key → `fallback_analyze(text)`: keyword scoring (positive/negative word lists + regex for "qualification", "pledge", "related party") → same dict shape, `method=fallback`.
   - Parse model output defensively: strip ```json fences, `json.loads`, on failure → fallback.

5. **`api/docs.py`**:
   - `POST /docs/fetch`: for each symbol in latest screen_run → filings → fetcher. Return counts.
   - `POST /docs/analyze`: for each `parsed`/pending doc without analysis → parser + analyzer → insert `doc_analysis`. Return `{analyzed, fallback_used, failed}`.
   - `GET /docs/{symbol}`: documents joined with doc_analysis for UI.

## Tests

- Parser on a small fixture PDF (`tests/fixtures/sample.pdf` — generate minimal 1-page PDF in test setup via fpdf2 or commit a tiny one).
- Analyzer: mock `genai.GenerativeModel` — success JSON, markdown-fenced JSON, garbage (→fallback), exception (→fallback). Assert `method` flag each case.
- Fetcher: mock httpx; assert idempotent skip when file exists.

## Acceptance

- End-to-end on 1 real shortlisted stock: PDFs on disk, analysis rows in DB, ≥1 `gemini` method row (or documented fallback if no API key).
- pytest green offline.
