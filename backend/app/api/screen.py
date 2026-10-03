"""Screen API: thin routers — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.deps import current_user
from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.screener import runner, service
from app.screener.catalog import RATIO_CATALOG
from app.screener.criteria import ScreeningSetCreate, ScreeningSetUpdate

router = APIRouter()

_NOT_FOUND = "Screen not found"
_MID_RUN = "Screen is mid-run"


def get_provider() -> DataProvider:
    return YFinanceProvider()


def _reject_if_busy(set_id: int, user_id: int) -> None:
    """409 when the target set has queued/running items in the caller's job."""
    if set_id in service.busy_set_ids(SessionLocal, user_id):
        raise HTTPException(status_code=409, detail=_MID_RUN)


@router.get("/ratios")
def ratios(user: dict = Depends(current_user)) -> list[dict]:
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "unit": spec.unit,
            "category": spec.category,
            "direction": spec.direction,
        }
        for spec in RATIO_CATALOG
    ]


@router.get("/sets")
def list_sets(user: dict = Depends(current_user)) -> list[dict]:
    init_db()
    return service.list_sets(SessionLocal, user["id"])


@router.post("/sets", status_code=201)
def create_set(payload: ScreeningSetCreate, user: dict = Depends(current_user)) -> dict:
    init_db()
    criteria = (
        [item.model_dump() for item in payload.criteria] if payload.criteria is not None else None
    )
    return service.create_set(SessionLocal, user["id"], payload.name, criteria, payload.thesis)


@router.put("/sets/{set_id}")
def update_set(
    set_id: int, payload: ScreeningSetUpdate, user: dict = Depends(current_user)
) -> dict:
    init_db()
    _reject_if_busy(set_id, user["id"])
    changes = payload.model_dump(exclude_unset=True)
    try:
        return service.update_set(SessionLocal, user["id"], set_id, changes)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


@router.delete("/sets/{set_id}", status_code=204)
def delete_set(set_id: int, user: dict = Depends(current_user)) -> None:
    init_db()
    _reject_if_busy(set_id, user["id"])
    try:
        service.delete_set(SessionLocal, user["id"], set_id)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    except service.LastSetError:
        raise HTTPException(status_code=400, detail="The last screen cannot be deleted")


@router.post("/sets/{set_id}/activate")
def activate_set(set_id: int, user: dict = Depends(current_user)) -> dict:
    init_db()
    _reject_if_busy(set_id, user["id"])
    try:
        return service.activate_set(SessionLocal, user["id"], set_id)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


@router.post("/run")
def run_screen(user: dict = Depends(current_user)):
    """Cached-first run: snapshot now, background refresh job after (Phase 1.8)."""
    init_db()
    job = service.latest_job(SessionLocal, user["id"])  # sweeps stale runs first
    if job is not None and job["status"] == "running":
        return JSONResponse(
            status_code=409,
            content={"detail": "Run already in progress", "job_id": job["id"]},
        )
    stored = service.get_criteria(SessionLocal, user["id"])
    provider = get_provider()
    # Snapshot first: a provider burst (502) must not leave a stuck running job.
    run = service.run_snapshot_screen(
        provider,
        SessionLocal,
        user,
        stored["criteria"],
        stored["shortlist_size"],
        stored["id"],
    )
    job = service.create_job(SessionLocal, user["id"], stored["id"])
    # Register before the first read: without it, this endpoint's own
    # ``latest_job`` would sweep the fresh job to ``interrupted`` (R6).
    service.register_active_job(job["id"])
    service.mark_item(SessionLocal, job["id"], stored["id"], "done", run_id=run["run_id"])
    runner.submit_job(job["id"], provider, SessionLocal)
    return {"run": run, "job": service.latest_job(SessionLocal, user["id"])}


@router.get("/jobs/latest")
def latest_job(user: dict = Depends(current_user)) -> dict:
    init_db()
    return {"job": service.latest_job(SessionLocal, user["id"])}


@router.get("/latest")
def latest_screen(user: dict = Depends(current_user)) -> dict:
    init_db()
    latest = service.latest_screen(SessionLocal, user["id"])
    if latest is None:
        raise HTTPException(status_code=404, detail="No screen run yet")
    return latest
