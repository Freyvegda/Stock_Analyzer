from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ScreeningSet(Base):
    """A named screening criteria set — one row per screen a user owns.

    Exactly one row per user is active (``is_active``); service code enforces the
    invariant (Phase 1.7). ``criteria_json`` is the same ``[{key, enabled, value}]``
    payload the engine consumes; ``shortlist_size`` stays server-owned.
    """

    __tablename__ = "screening_sets"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_screening_sets_user_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    criteria_json: Mapped[str] = mapped_column(Text, nullable=False)
    thesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    shortlist_size: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class AuthSession(Base):
    """One issued refresh token. The row *is* the revocation mechanism.

    Only the SHA-256 of the token is stored, so a database leak yields no usable
    credential. ``revoked_at IS NULL`` means live; logout writes it. ``last_seen_at``
    slides on every refresh and drives the 3-hour idle logout — there is no
    ``expires_at``, because a session that keeps being used should not die on a
    clock.
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    last_seen_at: Mapped[str] = mapped_column(String, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String, nullable=True)


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
    data_status: Mapped[str] = mapped_column(String, nullable=False, server_default="ok")
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class CompanyProfile(Base):
    """Slow-moving company identity from yfinance `.info` — one row per symbol.

    Ratios live in dated ``fundamentals`` rows; this table holds the fields the
    stock detail page repeats on every view (description, HQ, website, ...).
    """

    __tablename__ = "company_profiles"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    sector: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    employees: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hq: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class ScreenRun(Base):
    __tablename__ = "screen_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[str] = mapped_column(String)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    set_id: Mapped[int | None] = mapped_column(
        ForeignKey("screening_sets.id"), nullable=True, index=True
    )
    triggered_by: Mapped[str] = mapped_column(
        String, nullable=False, server_default="manual", default="manual"
    )
    criteria_json: Mapped[str] = mapped_column(Text, nullable=False)
    shortlisted_json: Mapped[str] = mapped_column(Text, nullable=False)


class RunJob(Base):
    """Background job driving one cached-first screen run (Phase 1.8).

    Append-only progress record: ``screen_runs`` stays the shortlist audit, this
    table tracks the async refresh job (counters, status, interruption).
    """

    __tablename__ = "run_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("screening_sets.id"), nullable=False)
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)  # running|done|failed|interrupted
    universe_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    universe_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    universe_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class RunJobItem(Base):
    """One screen inside a ``run_jobs`` job — progress + persisted run link (Phase 1.8).

    ``set_id`` is a plain FK (no cascade) so job history survives screen deletion;
    ``run_id`` lands once that screen's shortlist is persisted and stays NULL when
    the job failed before writing one.
    """

    __tablename__ = "run_job_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("run_jobs.id"), nullable=False, index=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("screening_sets.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)  # queued|running|done|failed
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("screen_runs.id"), nullable=True)


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
