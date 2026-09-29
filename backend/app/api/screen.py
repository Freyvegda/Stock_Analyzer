"""Screen API: thin routers — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import current_user
from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.screener import service
from app.screener.catalog import RATIO_CATALOG
from app.screener.criteria import ScreeningSetCreate, ScreeningSetUpdate

router = APIRouter()

_NOT_FOUND = "Screen not found"


def get_provider() -> DataProvider:
    return YFinanceProvider()


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
    changes = payload.model_dump(exclude_unset=True)
    try:
        return service.update_set(SessionLocal, user["id"], set_id, changes)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


@router.delete("/sets/{set_id}", status_code=204)
def delete_set(set_id: int, user: dict = Depends(current_user)) -> None:
    init_db()
    try:
        service.delete_set(SessionLocal, user["id"], set_id)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    except service.LastSetError:
        raise HTTPException(status_code=400, detail="The last screen cannot be deleted")


@router.post("/sets/{set_id}/activate")
def activate_set(set_id: int, user: dict = Depends(current_user)) -> dict:
    init_db()
    try:
        return service.activate_set(SessionLocal, user["id"], set_id)
    except service.SetNotFoundError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


@router.post("/run")
def run_screen(user: dict = Depends(current_user)) -> dict:
    init_db()
    stored = service.get_criteria(SessionLocal, user["id"])
    return service.run_screen(
        get_provider(),
        SessionLocal,
        user,
        stored["criteria"],
        stored["shortlist_size"],
        stored["id"],
    )


@router.get("/latest")
def latest_screen(user: dict = Depends(current_user)) -> dict:
    init_db()
    latest = service.latest_screen(SessionLocal, user["id"])
    if latest is None:
        raise HTTPException(status_code=404, detail="No screen run yet")
    return latest
