from fastapi import APIRouter

router = APIRouter()


@router.post("/run")
def run_screen() -> dict:
    # Phase 1: fetch fundamentals, apply YAML ratio engine, store screen_run
    return {"status": "not_implemented", "phase": 1}


@router.get("/latest")
def latest_screen() -> dict:
    # Phase 1: return most recent screen_run with shortlisted stocks
    return {"status": "not_implemented", "phase": 1}
