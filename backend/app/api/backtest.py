from fastapi import APIRouter

router = APIRouter()


@router.post("/run")
def run_backtest() -> dict:
    # Phase 4: walk-forward backtest, 3y train / 1q test, rolling
    return {"status": "not_implemented", "phase": 4}


@router.get("/{backtest_id}")
def get_backtest(backtest_id: int) -> dict:
    # Phase 4: return report (CAGR, Sharpe, max drawdown vs Nifty)
    return {"status": "not_implemented", "phase": 4, "id": backtest_id}
