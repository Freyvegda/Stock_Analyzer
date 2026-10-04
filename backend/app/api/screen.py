"""Screen API: thin routers — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.deps import current_user
from app.data.composite_impl import build_default_provider
from app.data.provider import DataProvider
from app.db.database import SessionLocal, init_db
from app.screener import runner, service
from app.screener.catalog import RATIO_CATALOG
from app.screener.criteria import ScreeningSetCreate, ScreeningSetUpdate

router = APIRouter()

_NOT_FOUND = "Screen not found"
_MID_RUN = "Screen is mid-run"


def get_provider() -> DataProvider:
    return build_default_provider()


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
    """Cached-first batch run: snapshot now, background refresh job after (Phase 1.8)."""
    init_db()
    job = service.latest_job(SessionLocal, user["id"])  # sweeps stale runs first
    if job is not None and job["status"] == "running":
        # TOCTOU accepted: two concurrent POSTs can both read "not running" and
        # create jobs. Single-user local tool — the single worker serializes
        # execution and the second job's latest_job read reports it running.
        return JSONResponse(
            status_code=409,
            content={"detail": "Run already in progress", "job_id": job["id"]},
        )
    provider = get_provider()
    # Snapshot first: zero fundamentals() calls, so a provider burst (502)
    # must not leave a stuck running job — and the batch costs one snapshot
    # for the active screen plus the most-used others.
    batch = service.run_snapshot_batch(provider, SessionLocal, user)
    run = batch["run"]
    job = service.create_job(SessionLocal, user["id"], batch["set_id"])
    # Register before the first read: without it, this endpoint's own
    # ``latest_job`` would sweep the fresh job to ``interrupted`` (R6).
    service.register_active_job(job["id"])
    try:
        service.mark_item(SessionLocal, job["id"], batch["set_id"], "done", run_id=run["run_id"])
        runner.submit_job(job["id"], provider, SessionLocal)
    except Exception:
        # Never leave the job registered when the kick fails: else the sweep
        # skips it forever and the account is wedged until a restart.
        service.unregister_active_job(job["id"])
        raise
    return {"run": run, "extra_runs": batch["extra_runs"], "job": service.latest_job(SessionLocal, user["id"])}


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
