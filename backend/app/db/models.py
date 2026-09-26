from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Stock(Base):
    __tablename__ = "stocks"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    sector: Mapped[str | None] = mapped_column(String, nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)


class Fundamental(Base):
    __tablename__ = "fundamentals"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[str] = mapped_column(String, primary_key=True)
    pe: Mapped[float | None] = mapped_column(Float, nullable=True)
    pb: Mapped[float | None] = mapped_column(Float, nullable=True)
    roe: Mapped[float | None] = mapped_column(Float, nullable=True)
    roce: Mapped[float | None] = mapped_column(Float, nullable=True)
    debt_to_equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class ScreenRun(Base):
    __tablename__ = "screen_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[str] = mapped_column(String)
    config_yaml: Mapped[str] = mapped_column(Text)
    shortlisted_json: Mapped[str] = mapped_column(Text)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)  # concall|results|presentation|audit
    period: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    parse_status: Mapped[str] = mapped_column(String, default="pending")


class DocAnalysis(Base):
    __tablename__ = "doc_analysis"

    document_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    method: Mapped[str] = mapped_column(String)  # gemini|fallback
    sentiment: Mapped[float | None] = mapped_column(Float, nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    red_flags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)


class Price(Base):
    __tablename__ = "prices"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[str] = mapped_column(String, primary_key=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)


class Signal(Base):
    __tablename__ = "signals"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[str] = mapped_column(String, primary_key=True)
    model: Mapped[str] = mapped_column(String, primary_key=True)
    signal: Mapped[str] = mapped_column(String)  # buy|sell|hold
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[str] = mapped_column(String)
    params_json: Mapped[str] = mapped_column(Text)
    cagr: Mapped[float | None] = mapped_column(Float, nullable=True)
    sharpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_drawdown: Mapped[float | None] = mapped_column(Float, nullable=True)
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)
