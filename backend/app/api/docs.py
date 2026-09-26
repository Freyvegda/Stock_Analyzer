from fastapi import APIRouter

router = APIRouter()


@router.post("/fetch")
def fetch_docs() -> dict:
    # Phase 2: download concall/results/audit PDFs for shortlisted stocks
    return {"status": "not_implemented", "phase": 2}


@router.post("/analyze")
def analyze_docs() -> dict:
    # Phase 2: Gemini Flash analysis with keyword fallback
    return {"status": "not_implemented", "phase": 2}


@router.get("/{symbol}")
def get_docs(symbol: str) -> dict:
    # Phase 2: list documents + analysis for one stock
    return {"status": "not_implemented", "phase": 2, "symbol": symbol}
