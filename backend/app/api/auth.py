"""Auth API: state / setup / login / refresh / logout / me (thin routers).

Two response shapes exist, and the difference matters:

- Login and setup answer with a **token bundle** `{user, access_token, token_type,
  expires_in}` plus an HttpOnly refresh cookie. The access token is returned in
  the body because the client holds it in memory and sends it as a bearer header;
  the refresh token is *never* in the body, only in the cookie.
- `me` and `state` answer with a user, because they take the bearer header.

`logout` and `refresh` deliberately do **not** depend on `current_user`. A logout
arriving after the 15-minute access token expired must still revoke the refresh
cookie, or the session would survive its own sign-out.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.auth import service
from app.auth.deps import current_user
from app.auth.security import ACCESS_TTL_SECONDS, InvalidToken, decode_access_token, sign_access_token
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


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        service.REFRESH_COOKIE,
        token,
        max_age=service.REFRESH_COOKIE_MAX_AGE,
        httponly=True,
        samesite="strict",
        path="/",  # see service.REFRESH_COOKIE: "/auth" would never be sent
    )


def _bundle(user: dict) -> dict:
    return {
        "user": user,
        "access_token": sign_access_token(user),
        "token_type": "bearer",
        "expires_in": ACCESS_TTL_SECONDS,
    }


def _expired_cookie_response() -> Response:
    """A throwaway response carrying a Set-Cookie that clears the refresh cookie.

    Needed on error paths: `set_cookie` on the injected `response` is lost when the
    handler raises, because FastAPI builds a fresh response for the exception. The
    error responses attach this one so a dead cookie is cleared either way.
    """
    response = Response()
    response.delete_cookie(service.REFRESH_COOKIE, path="/")
    return response


@router.get("/state")
def auth_state(request: Request) -> dict:
    """Public. Tells the login card whether to offer setup or login, and who is signed in.

    Resolving the user is best-effort: a missing or broken token is simply "not
    signed in". This endpoint must never 401 — the login page calls it before it
    has any credentials.
    """
    init_db()
    user = None
    token = deps_bearer(request)
    if token:
        try:
            user = service.get_user(SessionLocal, int(decode_access_token(token)["sub"]))
        except (InvalidToken, KeyError, ValueError):
            user = None
    return {"users_exist": service.users_exist(SessionLocal), "user": user}


def deps_bearer(request: Request) -> str | None:
    """Reuse the dependency's header parsing without raising."""
    from app.auth.deps import _bearer_token

    return _bearer_token(request)


@router.post("/setup", status_code=201)
def setup(payload: Credentials, response: Response) -> dict:
    init_db()
    try:
        user = service.create_user(SessionLocal, payload.username, payload.password)
    except UserExistsError as exc:
        # Raise through a real response so the raise-time cookie deletion below
        # survives: FastAPI's HTTPException discards the injected `response`.
        err = HTTPException(status_code=409, detail="Account already exists")
        err.response = _expired_cookie_response()
        raise err from exc
    with SessionLocal() as session:
        service.sweep_sessions(session)  # a fresh account inherits nothing
    token = service.issue_refresh_token(SessionLocal, user["id"])
    _set_refresh_cookie(response, token)
    return _bundle(user)


@router.post("/login")
def login(payload: Credentials, response: Response) -> dict:
    init_db()
    user = service.authenticate(SessionLocal, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    with SessionLocal() as session:
        service.sweep_sessions(session)  # bound the table: drop revoked + unreachable rows
    token = service.issue_refresh_token(SessionLocal, user["id"])
    _set_refresh_cookie(response, token)
    return _bundle(user)


@router.post("/refresh")
def refresh(request: Request, response: Response) -> dict:
    """Exchange the refresh cookie for a new access token, rotating the refresh token.

    No `current_user` dependency: the access token may be expired or absent, which
    is the normal reason to be here.
    """
    raw = request.cookies.get(service.REFRESH_COOKIE)
    user, replacement = service.rotate_session(SessionLocal, raw) if raw else (None, None)
    if user is None or replacement is None:
        # Clear the cookie on failure so a dead client stops retrying, and so a
        # rotation that killed the old token cannot be replayed from the jar.
        err = HTTPException(status_code=401, detail="Not authenticated")
        err.response = _expired_cookie_response()
        raise err
    _set_refresh_cookie(response, replacement)
    return _bundle(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    """Revoke the refresh session and clear the cookie. Always 204.

    Deliberately unauthenticated: a logout after the access token expired must
    still revoke the session, and answering anything but 204 would leave the
    client unsure whether it is signed out.
    """
    service.revoke_refresh_token(SessionLocal, request.cookies.get(service.REFRESH_COOKIE))
    response.delete_cookie(service.REFRESH_COOKIE, path="/")


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user
