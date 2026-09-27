import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth, backtest, docs, screen, signals, stock, stocks
from app.auth.deps import current_user
from app.auth.security import SESSION_MAX_AGE, session_secret
from app.screener.criteria import ConfigError

app = FastAPI(title="Stock Analyzer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret(),
    session_cookie="sa_session",
    max_age=SESSION_MAX_AGE,
    same_site="lax",
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(screen.router, prefix="/screen", tags=["screen"])
app.include_router(stock.router, prefix="/stock", tags=["stock"], dependencies=[Depends(current_user)])
app.include_router(stocks.router, prefix="/stocks", tags=["stocks"], dependencies=[Depends(current_user)])
app.include_router(docs.router, prefix="/docs", tags=["docs"], dependencies=[Depends(current_user)])
app.include_router(signals.router, prefix="/model", tags=["model"], dependencies=[Depends(current_user)])
app.include_router(backtest.router, prefix="/backtest", tags=["backtest"], dependencies=[Depends(current_user)])


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0]
    loc = ".".join(str(part) for part in first["loc"][1:]) or "body"
    return JSONResponse(status_code=422, content={"detail": f"{loc}: {first['msg']}"})


@app.exception_handler(ConfigError)
async def config_error_handler(_request: Request, exc: ConfigError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(httpx.HTTPError)
async def upstream_error_handler(_request: Request, exc: httpx.HTTPError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": f"Upstream data source failed: {exc}"})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
