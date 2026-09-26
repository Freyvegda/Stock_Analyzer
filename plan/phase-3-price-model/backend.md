# Phase 3 — Price Model (Backend)

> Read `backend/BACKEND.md` first. Model rule: XGBoost behind `Model` interface; LSTM optional; NO transformer.

## Goal

5yr daily OHLC per shortlisted stock → engineered features → XGBoost classifier → buy/sell/hold signals in `signals` table → API.

## Tasks

1. **`data/yfinance_impl.py` — `ohlc(symbol, years=5)`**:
   - `yfinance.download(f"{symbol}.NS", period="5y", interval="1d", auto_adjust=True)` → rows `[{date, open, high, low, close, volume}]`. Empty df → raise `DataUnavailable`; caller marks stock failed, continues.
   - Ingest: upsert into `prices` (composite PK → idempotent).

2. **`models/features.py`**:
   - Pure functions, pandas in/out: `build_features(df) -> df` adds:
     - returns: 1d/5d/21d pct change
     - moving averages: SMA20, SMA50, SMA200 + price/SMA ratios
     - RSI(14), MACD histogram
     - volatility: 21d rolling std of returns
     - volume: 21d avg ratio
   - `make_target(df, horizon=21) -> series`: 1 if forward 21d return > +5%, -1 if < -5%, else 0. (Holdings are long-duration per user; horizon/thresholds as module constants, tuned in Phase 4.)

3. **`models/base.py`**: ABC `train(symbol, df)`, `predict(symbol, df) -> list[{date, signal, confidence}]`, `name` attr.

4. **`models/xgboost_model.py`**:
   - `XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05)`; classes {-1,0,1} → map to sell/hold/buy.
   - Train/test: last 60 rows held out for sanity accuracy print (real validation is Phase 4 walk-forward).
   - Confidence = predict_proba max. Persist model per symbol via `joblib` to `data/models/{symbol}_xgboost-v1.joblib`.

5. **`api/signals.py`**:
   - `POST /model/train` `{symbol?}`: default all shortlisted. Ingest prices → features → train → save model. Return per-symbol train accuracy.
   - `POST /model/predict`: load model per shortlisted symbol, predict latest row → upsert `signals` (model=`xgboost-v1`, today).
   - `GET /model/signals?symbol=`: rows joined to prices for charting (`GET /model/prices?symbol=` also needed for candles — add it).

## Tests

- `features.py`: fixture df (100 synthetic rows, known formula) → assert RSI range 0-100, SMA values vs hand-calc on small window, no NaN after warmup dropped.
- Target: known price path → expected labels.
- XGBoost: trains on synthetic 300-row df, predict returns valid signal/confidence in [0,1].
- API: mocked provider + tmp model dir; train→predict→signals round trip.

## Acceptance

- Train + predict on 1 real stock via API; signal row in DB; sanity accuracy printed.
- pytest green offline.
