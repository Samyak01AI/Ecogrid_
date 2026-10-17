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


# --- Replace everything between these markers with your trained model -------------------
def load_model():
    """Load weights once at startup (e.g. joblib.load('model.pkl'), onnxruntime.InferenceSession(...))."""
    return None


MODEL = load_model()

SURFACE_HEAT = {"paved": 0.20, "building": 0.15, "mixed": 0.0, "soil": -0.05, "green": -0.18}
PEDESTRIAN_BY_LAND_USE = {"plaza": 0.25, "pedestrian_zone": 0.30, "road": 0.20, "building": -0.10, "green_space": 0.0}


def predict_cell(cell: CellIn) -> Prediction:
    """Deterministic heuristic used until a real model exists. Not a trained model."""
    green = clamp(cell.existingGreenCover)
    heat = clamp(0.45 + SURFACE_HEAT.get(cell.surfaceType, 0.0) - 0.25 * green)
    vegetation = clamp(0.75 - 0.60 * green + (0.10 if cell.surfaceType == "paved" else 0.0))
    pedestrian = clamp(0.35 + PEDESTRIAN_BY_LAND_USE.get(cell.landUse, 0.0))
    connectivity = clamp(0.50 - 0.30 * green + (0.05 if cell.surfaceType == "paved" else 0.0))
    # Real models: derive from quantile regression / ensemble variance / conformal intervals.
    confidence = clamp(0.82 - (0.10 if cell.surfaceType == "mixed" else 0.0) - (0.08 if cell.surfaceType == "building" else 0.0))
    spread = (1.0 - confidence) * 0.25
    return Prediction(
        id=cell.id,
        heat=heat,
        vegetation=vegetation,
        pedestrian=pedestrian,
        connectivity=connectivity,
        confidence=confidence,
        lower=clamp(heat - spread),
        upper=clamp(heat + spread),
    )
# -----------------------------------------------------------------------------------------


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
