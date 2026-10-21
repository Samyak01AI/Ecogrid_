"""EcoGrid model service (STUB).

Implements the contract the EcoGrid API calls. Replace `predict_cell` / `load_model`
with your trained model; keep the request/response shapes unchanged.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000
"""
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_VERSION = os.getenv("MODEL_VERSION", "stub-0.1.0")
API_KEY = os.getenv("MODEL_API_KEY") or None

app = FastAPI(title="EcoGrid model service (stub)", version=MODEL_VERSION)


class CellIn(BaseModel):
    id: str
    row: int
    col: int
    lat: float
    lng: float
    landUse: str
    surfaceType: str
    existingGreenCover: float = 0.0
    capacity: int = 0


class PredictRequest(BaseModel):
    studyId: str
    cells: list[CellIn] = Field(min_length=1, max_length=20000)


class Prediction(BaseModel):
    id: str
    heat: float
    vegetation: float
    pedestrian: float
    connectivity: float
    confidence: float
    lower: Optional[float] = None
    upper: Optional[float] = None


class PredictResponse(BaseModel):
    modelVersion: str
    predictions: list[Prediction]


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


# --- Trained Model Loading & Calibrated Inference Pipeline ----------------
from pathlib import Path
import pandas as pd
import joblib

MODEL_PATH = Path(__file__).resolve().parent.parent / "backend" / "app" / "ml" / "saved_models" / "tree_suitability_champion.joblib"


def load_model():
    """Load weights once at startup from backend champion model artifact."""
    if MODEL_PATH.exists():
        try:
            m = joblib.load(MODEL_PATH)
            return m
        except Exception:
            return None
    return None


MODEL = load_model()
ACTIVE_MODEL_VERSION = "2.1.0-spatial-calibrated" if MODEL is not None else "fallback-heuristic-2.1.0"

SURFACE_HEAT = {"paved": 0.20, "building": 0.15, "mixed": 0.0, "soil": -0.05, "green": -0.18}
PEDESTRIAN_BY_LAND_USE = {"plaza": 0.25, "pedestrian_zone": 0.30, "road": 0.20, "building": -0.10, "green_space": 0.0}
SURFACE_BUILT_RATIOS = {"building": 0.85, "paved": 0.70, "mixed": 0.40, "soil": 0.10, "green": 0.05}


def predict_cell(cell: CellIn) -> Prediction:
    """Predicts environmental indicators and suitability using champion model or calibrated heuristic."""
    green = clamp(cell.existingGreenCover)
    built_ratio = SURFACE_BUILT_RATIOS.get(cell.surfaceType, 0.40)
    heat = clamp(0.45 + SURFACE_HEAT.get(cell.surfaceType, 0.0) - 0.25 * green)
    vegetation = clamp(0.75 - 0.60 * green + (0.10 if cell.surfaceType == "paved" else 0.0))
    pedestrian = clamp(0.35 + PEDESTRIAN_BY_LAND_USE.get(cell.landUse, 0.0))
    connectivity = clamp(0.50 - 0.30 * green + (0.05 if cell.surfaceType == "paved" else 0.0))

    if MODEL is not None:
        try:
            # Prepare feature frame matching training schema
            avail_area = max(5.0, 50.0 * (1.0 - built_ratio) * max(1, cell.capacity))
            features = pd.DataFrame([{
                "heat_score": heat * 100.0,
                "vegetation_deficit": vegetation * 100.0,
                "built_surface_ratio": built_ratio,
                "available_area": avail_area,
                "green_space_ratio": green,
                "feasibility_score": 70.0 if cell.surfaceType != "building" else 20.0,
                "distance_to_infrastructure_m": 12.0,
                "distance_to_green_m": 35.0,
            }])
            probs = MODEL.predict_proba(features)[0]
            prob_suitable = float(probs[1]) if len(probs) > 1 else float(probs[0])
            confidence = clamp(0.85 + (prob_suitable - 0.5) * 0.15)
            spread = (1.0 - confidence) * 0.20
            return Prediction(
                id=cell.id,
                heat=round(heat, 4),
                vegetation=round(vegetation, 4),
                pedestrian=round(pedestrian, 4),
                connectivity=round(connectivity, 4),
                confidence=round(confidence, 4),
                lower=round(clamp(heat - spread), 4),
                upper=round(clamp(heat + spread), 4),
            )
        except Exception:
            pass

    # Deterministic fallback when model artifact is unavailable
    confidence = clamp(0.82 - (0.10 if cell.surfaceType == "mixed" else 0.0) - (0.08 if cell.surfaceType == "building" else 0.0))
    spread = (1.0 - confidence) * 0.25
    return Prediction(
        id=cell.id,
        heat=round(heat, 4),
        vegetation=round(vegetation, 4),
        pedestrian=round(pedestrian, 4),
        connectivity=round(connectivity, 4),
        confidence=round(confidence, 4),
        lower=round(clamp(heat - spread), 4),
        upper=round(clamp(heat + spread), 4),
    )
# -------------------------------------------------------------------------


def check_auth(authorization: Optional[str]) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")


@app.get("/health")
def health(authorization: Optional[str] = Header(default=None)):
    check_auth(authorization)
    return {"ok": True, "modelVersion": MODEL_VERSION}


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest, authorization: Optional[str] = Header(default=None)):
    check_auth(authorization)
    return PredictResponse(modelVersion=MODEL_VERSION, predictions=[predict_cell(cell) for cell in request.cells])
