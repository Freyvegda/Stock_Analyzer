import concurrent.futures
import json
from datetime import date

from fastapi import APIRouter, HTTPException

from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.db.models import Fundamental, ScreenRun, Stock
from app.screener.config import CONFIG_PATH, load_config, reload_config
from app.screener.engine import apply_screen

router = APIRouter()


def get_provider() -> DataProvider:
    return YFinanceProvider()


@router.post("/run")
def run_screen() -> dict:
    init_db()
    provider = get_provider()
    config = load_config()
    today = date.today().isoformat()

    stocks = provider.list_stocks()
    failed = 0
    rows: list[dict] = []

    # 500 sequential yfinance calls are too slow — parallel fetch.
    # MVP: synchronous endpoint; an async job queue is a later optimization.
    def fetch_one(s: dict) -> dict | None:
        try:
            return provider.fundamentals(s["symbol"])
        except Exception:
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch_one, stocks))

    with SessionLocal() as session:
        for s, f in zip(stocks, results):
            session.merge(
                Stock(symbol=s["symbol"], name=s["name"], sector=s["sector"], market_cap=f and f.get("market_cap"))
            )
            if f is None:
                failed += 1
                continue
            session.merge(
                Fundamental(
                    symbol=f["symbol"],
                    date=today,
                    pe=f["pe"],
                    pb=f["pb"],
                    roe=f["roe"],
                    roce=f["roce"],
                    debt_to_equity=f["debt_to_equity"],
                    raw_json=json.dumps(f["raw"], default=str),
                )
            )
            rows.append({**f, "market_cap": f.get("market_cap")})
        shortlist = apply_screen(rows, config)
        run = ScreenRun(run_date=today, config_yaml=open(CONFIG_PATH, encoding="utf-8").read(), shortlisted_json=json.dumps(shortlist))
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

    return {"run_id": run_id, "shortlisted": shortlist, "failed_count": failed, "total": len(stocks)}


@router.get("/latest")
def latest_screen() -> dict:
    init_db()
    with SessionLocal() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
        if run is None:
            raise HTTPException(status_code=404, detail="No screen run yet")
        shortlist = json.loads(run.shortlisted_json)
        meta = {
            s.symbol: {"name": s.name, "sector": s.sector, "market_cap": s.market_cap}
            for s in session.query(Stock).filter(Stock.symbol.in_([r["symbol"] for r in shortlist]))
        }
        for row in shortlist:
            row.update(meta.get(row["symbol"], {}))
        return {"run_id": run.id, "run_date": run.run_date, "shortlisted": shortlist}


@router.get("/config")
def get_config() -> dict:
    return load_config()


@router.post("/config/reload")
def reload() -> dict:
    return reload_config()
