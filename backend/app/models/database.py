"""
EcoGrid AI — SQLAlchemy Database Models with PostGIS & Audit Trail Support.
(Stage 5 & 6: Validation, Monitoring, Audit Trail & Human Planner Approval)

Schema covers:
- study_areas: Geographical bounding boxes and grids
- grid_cells: Uniform cells with spatial properties and environmental scores
- optimization_runs: Audit log of optimization runs with solver status, user_id, greedy benchmarks
- human_approvals: Human-in-the-loop sign-off (DRAFT, APPROVED, REJECTED)
- outcome_monitoring: Post-intervention satellite ground truth vs predicted temperature drops
- intervention_definitions: Catalogue of standard NBS interventions
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


class StudyArea(Base):
    __tablename__ = "study_areas"

    id = Column(String(128), primary_key=True)
    name = Column(String(256), nullable=False)
    origin_lat = Column(Float, nullable=False)
    origin_lng = Column(Float, nullable=False)
    rows = Column(Integer, nullable=False)
    columns = Column(Integer, nullable=False)
    cell_size_lat = Column(Float, nullable=False)
    cell_size_lng = Column(Float, nullable=False)
    data_label = Column(String(128), default="SYNTHETIC / DEMO")
    created_at = Column(DateTime, default=datetime.utcnow)

    cells = relationship("GridCell", back_populates="study_area", cascade="all, delete-orphan")
    optimization_runs = relationship("OptimizationRun", back_populates="study_area", cascade="all, delete-orphan")


class GridCell(Base):
    __tablename__ = "grid_cells"

    id = Column(String(128), primary_key=True)  # study_id:cell_id
    study_area_id = Column(String(128), ForeignKey("study_areas.id"), nullable=False)
    cell_id = Column(String(16), nullable=False)
    row = Column(Integer, nullable=False)
    col = Column(Integer, nullable=False)
    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    polygon_json = Column(Text, nullable=False)  # JSON array of [lat, lng] pairs
    area_name = Column(String(256))
    land_use = Column(String(32))
    surface_type = Column(String(32))

    # Environmental scores (0-100)
    heat_score = Column(Float, default=0)
    vegetation_deficit = Column(Float, default=0)
    pedestrian_exposure = Column(Float, default=0)
    connectivity_gap = Column(Float, default=0)
    feasibility_score = Column(Float, default=0)

    # Derived indicators
    tree_suitability = Column(Float, default=0)
    green_space_ratio = Column(Float, default=0)
    built_surface_ratio = Column(Float, default=0)
    available_area = Column(Float, default=0)
    existing_green_cover = Column(Float, default=0)
    priority_zone = Column(Boolean, default=False)
    capacity = Column(Integer, default=0)

    # Data provenance
    data_source = Column(String(32), default="synthetic_demo")
    data_status = Column(String(32), default="demo")

    study_area = relationship("StudyArea", back_populates="cells")


class OptimizationRun(Base):
    __tablename__ = "optimization_runs"

    id = Column(String(128), primary_key=True)
    study_area_id = Column(String(128), ForeignKey("study_areas.id"), nullable=False)
    user_id = Column(String(128), default="planner-1")
    name = Column(String(256), default="Optimization Run")
    budget = Column(Float, nullable=False)
    weights_json = Column(Text, nullable=False)
    solver_status = Column(String(32))
    total_cost = Column(Float, default=0)
    remaining_budget = Column(Float, default=0)
    utilization = Column(Float, default=0)
    combined_benefit = Column(Float, default=0)
    greedy_benefit = Column(Float, default=0)
    efficiency_gain_pct = Column(Float, default=0)
    category_benefits_json = Column(Text)
    selected_json = Column(Text)  # JSON array of selected candidates
    intervention_summary_json = Column(Text)
    cells_improved = Column(Integer, default=0)
    confidence_p50_temp_drop = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    study_area = relationship("StudyArea", back_populates="optimization_runs")
    approvals = relationship("HumanApproval", back_populates="run", cascade="all, delete-orphan")


class HumanApproval(Base):
    __tablename__ = "human_approvals"

    id = Column(String(128), primary_key=True)
    run_id = Column(String(128), ForeignKey("optimization_runs.id"), nullable=False)
    study_area_id = Column(String(128), ForeignKey("study_areas.id"), nullable=False)
    approval_status = Column(String(32), default="DRAFT")  # DRAFT, APPROVED, REJECTED
    approved_by = Column(String(128), default="Chief Urban Planner")
    reviewer_notes = Column(Text, default="")
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("OptimizationRun", back_populates="approvals")


class OutcomeMonitoring(Base):
    __tablename__ = "outcome_monitoring"

    id = Column(String(128), primary_key=True)
    study_area_id = Column(String(128), ForeignKey("study_areas.id"), nullable=False)
    run_id = Column(String(128), nullable=True)
    cell_id = Column(String(16), nullable=False)
    baseline_temp_c = Column(Float, nullable=False)
    predicted_temp_drop_c = Column(Float, nullable=False)
    observed_temp_c = Column(Float, nullable=False)
    actual_temp_drop_c = Column(Float, nullable=False)
    satellite_source = Column(String(64), default="Landsat 8/9 Band 10")
    observation_date = Column(DateTime, default=datetime.utcnow)
    validation_verdict = Column(String(32), default="WITHIN_ERROR_BOUNDS")
    created_at = Column(DateTime, default=datetime.utcnow)


class InterventionRecord(Base):
    __tablename__ = "intervention_definitions"

    id = Column(String(64), primary_key=True)
    name = Column(String(256), nullable=False)
    category = Column(String(64))
    measurement_unit = Column(String(32))
    unit_cost = Column(Float)
    unit_area = Column(Float, default=0)
    heat_benefit = Column(Float, default=0)
    biodiversity_benefit = Column(Float, default=0)
    connectivity_benefit = Column(Float, default=0)
    greenery_benefit = Column(Float, default=0)
    pedestrian_benefit = Column(Float, default=0)
    allowed_surfaces_json = Column(Text)
    allowed_land_uses_json = Column(Text)
    min_feasibility = Column(Float, default=0)
    marker_color = Column(String(16))
    icon = Column(String(32))


# ---------------------------------------------------------------------------
# Database engine and session
# ---------------------------------------------------------------------------

def get_engine(database_url: str | None = None):
    """Create SQLAlchemy engine. Falls back to SQLite if no PostGIS available."""
    url = database_url or settings.database_url
    if not url:
        url = "sqlite:///ecogrid_demo.db"
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return create_engine(url, echo=False, pool_pre_ping=True)


def get_session_factory(engine=None):
    """Create a session factory."""
    if engine is None:
        engine = get_engine()
    return sessionmaker(bind=engine)


def init_db(engine=None):
    """Create all tables and perform non-destructive schema migrations."""
    if engine is None:
        engine = get_engine()
    Base.metadata.create_all(engine)

    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            # Safely add columns to optimization_runs if table already existed
            cols = [
                ("user_id", "VARCHAR(128) DEFAULT 'planner-1'"),
                ("greedy_benefit", "FLOAT DEFAULT 0"),
                ("efficiency_gain_pct", "FLOAT DEFAULT 0"),
                ("confidence_p50_temp_drop", "FLOAT DEFAULT 0"),
            ]
            for col_name, col_def in cols:
                try:
                    conn.execute(text(f"ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS {col_name} {col_def};"))
                    conn.commit()
                except Exception:
                    pass
    except Exception:
        pass

    return engine

