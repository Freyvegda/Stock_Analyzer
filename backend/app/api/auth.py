"""Auth API: state / setup / login / logout / me (thin routers)."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import service
from app.auth.deps import current_user
from app.auth.service import UserExistsError
from app.db.database import SessionLocal, init_db

router = APIRouter()


class Credentials(BaseModel):
    """Setup/login body. Username is trimmed + lowercased before validation."""

    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8)

    @field_validator("username", mode="before")
    @classmethod
    def _normalize(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


@router.get("/state")
def auth_state(request: Request) -> dict:
    init_db()
    user = None
    user_id = request.session.get("user_id")
    if user_id:
        user = service.get_user(SessionLocal, user_id)
        if user is None:
            request.session.clear()
    return {"users_exist": service.users_exist(SessionLocal), "user": user}


@router.post("/setup", status_code=201)
def setup(payload: Credentials, request: Request) -> dict:
    init_db()
    try:
        user = service.create_user(SessionLocal, payload.username, payload.password)
    except UserExistsError:
        raise HTTPException(status_code=409, detail="Account already exists")
    request.session.update({"user_id": user["id"], "username": user["username"]})
    return {"user": user}


@router.post("/login")
def login(payload: Credentials, request: Request) -> dict:
    init_db()
    user = service.authenticate(SessionLocal, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session.update({"user_id": user["id"], "username": user["username"]})
    return {"user": user}


@router.post("/logout", status_code=204)
def logout(request: Request, user: dict = Depends(current_user)) -> None:
    request.session.clear()


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user
