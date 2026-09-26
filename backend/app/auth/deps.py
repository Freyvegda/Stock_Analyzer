"""FastAPI dependency: resolve the signed session cookie to a user.

401 with a single generic detail everywhere — the frontend listens for it and
redirects to /login.
"""

from fastapi import HTTPException, Request

from app.auth import service
from app.db.database import SessionLocal


def current_user(request: Request) -> dict:
    user_id = request.session.get("user_id")
    user = service.get_user(SessionLocal, user_id) if user_id else None
    if user is None:
        if user_id:
            request.session.clear()  # stale session (user deleted / DB reset)
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
