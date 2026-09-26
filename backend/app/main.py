from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import backtest, docs, screen, signals
from app.screener.config import ConfigError

app = FastAPI(title="Stock Analyzer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(screen.router, prefix="/screen", tags=["screen"])
app.include_router(docs.router, prefix="/docs", tags=["docs"])
app.include_router(signals.router, prefix="/model", tags=["model"])
app.include_router(backtest.router, prefix="/backtest", tags=["backtest"])


@app.exception_handler(ConfigError)
async def config_error_handler(_request: Request, exc: ConfigError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
