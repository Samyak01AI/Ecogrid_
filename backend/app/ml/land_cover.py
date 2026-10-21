"""
EcoGrid AI — Land-Cover Classification Model & Training Pipeline
(Section 6: Land-Cover Classification Model)

Classifies high-resolution multispectral satellite observations into four core land-cover categories:
- 0: VEGETATION (Tree canopy, shrub, parks, lawn)
- 1: BUILT_UP (Asphalt, concrete, rooftop, roads, parking)
- 2: BARE_SOIL (Exposed soil, construction sand, barren ground)
- 3: WATER (Lakes, retention ponds, drainage channels)

Features:
- Band 2 (Blue, ~490 nm)
- Band 3 (Green, ~560 nm)
- Band 4 (Red, ~665 nm)
- Band 8 (NIR, ~842 nm)
- NDVI = (NIR - Red) / (NIR + Red)
- NDWI = (Green - NIR) / (Green + NIR)
- NDBI = (Red - NIR) / (Red + NIR) [Visible-NIR built-up index proxy]

Baseline Model: Scikit-Learn Pipeline (SimpleImputer + StandardScaler + RandomForestClassifier)
Comparative Model: XGBoost Pipeline (if installed)
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from enum import IntEnum
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:
    from xgboost import XGBClassifier
    _HAS_XGBOOST = True
except ImportError:
    _HAS_XGBOOST = False

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent / "saved_models"
MODEL_PATH = MODEL_DIR / "land_cover_rf.joblib"
METADATA_PATH = MODEL_DIR / "land_cover_metadata.json"

FEATURE_NAMES = [
    "band2_blue",
    "band3_green",
    "band4_red",
    "band8_nir",
    "ndvi",
    "ndwi",
    "ndbi",
]


class LandCoverClass(IntEnum):
    VEGETATION = 0
    BUILT_UP = 1
    BARE_SOIL = 2
    WATER = 3


CLASS_LABELS: dict[int, str] = {
    LandCoverClass.VEGETATION: "Vegetation",
    LandCoverClass.BUILT_UP: "Built-up Surface",
    LandCoverClass.BARE_SOIL: "Bare Soil",
    LandCoverClass.WATER: "Water Body",
}


def compute_spectral_indices(
    blue: float,
    green: float,
    red: float,
    nir: float,
) -> dict[str, float]:
    """Calculate NDVI, NDWI, and NDBI from surface reflectance."""
    eps = 1e-6
    ndvi = (nir - red) / (nir + red + eps)
    ndwi = (green - nir) / (green + nir + eps)
    ndbi = (red - nir) / (red + nir + eps)
    return {
        "band2_blue": float(blue),
        "band3_green": float(green),
        "band4_red": float(red),
        "band8_nir": float(nir),
        "ndvi": float(np.clip(ndvi, -1.0, 1.0)),
        "ndwi": float(np.clip(ndwi, -1.0, 1.0)),
        "ndbi": float(np.clip(ndbi, -1.0, 1.0)),
    }


def generate_benchmark_land_cover_dataset(
    n_samples_per_class: int = 500,
    seed: int = 20261021,
) -> pd.DataFrame:
    """
    Generates a reproducible spectral benchmark dataset based on empirical
    Sentinel-2 Level-2A surface reflectance distributions across urban land cover:
    
    1. Vegetation: Low Red (0.02-0.08), High NIR (0.35-0.65), High NDVI (>0.6)
    2. Built-up: Moderate Red (0.15-0.35), Moderate NIR (0.18-0.38), Moderate/Low NDVI
    3. Bare Soil: High Red (0.20-0.45), Moderate NIR (0.25-0.50), Low NDVI (0.1-0.25)
    4. Water: Low Red (0.01-0.05), Near-zero NIR (0.00-0.03), Negative NDVI, High NDWI
    """
    rng = np.random.RandomState(seed)
    records = []

    for c in LandCoverClass:
        n = n_samples_per_class
        if c == LandCoverClass.VEGETATION:
            blue = rng.uniform(0.01, 0.05, n)
            green = rng.uniform(0.04, 0.12, n)
            red = rng.uniform(0.02, 0.08, n)
            nir = rng.uniform(0.35, 0.65, n)
        elif c == LandCoverClass.BUILT_UP:
            blue = rng.uniform(0.10, 0.22, n)
            green = rng.uniform(0.12, 0.25, n)
            red = rng.uniform(0.15, 0.35, n)
            nir = rng.uniform(0.16, 0.38, n)
        elif c == LandCoverClass.BARE_SOIL:
            blue = rng.uniform(0.08, 0.18, n)
            green = rng.uniform(0.12, 0.28, n)
            red = rng.uniform(0.20, 0.45, n)
            nir = rng.uniform(0.25, 0.50, n)
        else:  # WATER
            blue = rng.uniform(0.02, 0.08, n)
            green = rng.uniform(0.02, 0.07, n)
            red = rng.uniform(0.01, 0.05, n)
            nir = rng.uniform(0.005, 0.03, n)

        for i in range(n):
            indices = compute_spectral_indices(blue[i], green[i], red[i], nir[i])
            indices["target_class"] = int(c)
            indices["target_label"] = CLASS_LABELS[c]
            records.append(indices)

    df = pd.DataFrame(records)
    # Shuffle dataset
    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return df


def train_land_cover_model(
    n_samples_per_class: int = 500,
    seed: int = 42,
    force: bool = False,
) -> dict[str, Any]:
    """
    Trains and benchmarks the Land-Cover Classification pipeline.
    Saves trained pipeline artifact and metadata.
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if not force and MODEL_PATH.exists() and METADATA_PATH.exists():
        try:
            with open(METADATA_PATH, "r", encoding="utf-8") as f:
                meta = json.load(f)
            return {"status": "already_trained", "metadata": meta}
        except Exception:
            pass

    logger.info("Generating benchmark dataset for Land-Cover classification...")
    df = generate_benchmark_land_cover_dataset(n_samples_per_class=n_samples_per_class, seed=seed)

    X = df[FEATURE_NAMES]
    y = df["target_class"]

    # Stratified train/val/test split (70% train, 15% val, 15% test)
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=seed, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=seed, stratify=y_temp
    )

    # 1. Random Forest Baseline Pipeline (Imputer + Scaler + RF)
    rf_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("classifier", RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=4,
            random_state=seed,
            n_jobs=-1,
        )),
    ])
    rf_pipeline.fit(X_train, y_train)

    y_val_pred = rf_pipeline.predict(X_val)
    y_test_pred = rf_pipeline.predict(X_test)

    rf_test_acc = float(accuracy_score(y_test, y_test_pred))
    rf_test_macro_f1 = float(f1_score(y_test, y_test_pred, average="macro"))
    rf_test_balanced_acc = float(balanced_accuracy_score(y_test, y_test_pred))

    # Per-class metrics
    class_report = classification_report(y_test, y_test_pred, output_dict=True)
    conf_matrix = confusion_matrix(y_test, y_test_pred).tolist()

    # 2. XGBoost Comparator (if available)
    xgb_metrics = None
    champion_pipeline = rf_pipeline
    champion_name = "RandomForestClassifier"

    if _HAS_XGBOOST:
        xgb_pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("classifier", XGBClassifier(
                n_estimators=100,
                max_depth=4,
                learning_rate=0.1,
                random_state=seed,
                eval_metric="mlogloss",
            )),
        ])
        xgb_pipeline.fit(X_train, y_train)
        xgb_pred = xgb_pipeline.predict(X_test)
        xgb_acc = float(accuracy_score(y_test, xgb_pred))
        xgb_f1 = float(f1_score(y_test, xgb_pred, average="macro"))
        xgb_balanced = float(balanced_accuracy_score(y_test, xgb_pred))
        xgb_metrics = {"accuracy": xgb_acc, "macro_f1": xgb_f1, "balanced_accuracy": xgb_balanced}

        if xgb_f1 > rf_test_macro_f1:
            champion_pipeline = xgb_pipeline
            champion_name = "XGBClassifier"

    # Serialize Champion Pipeline
    joblib.dump(champion_pipeline, MODEL_PATH)

    # Compile Metadata
    metadata = {
        "model_name": "EcoGrid Land-Cover Spectral Classifier",
        "model_version": "2.1.0-rf-sentinel2",
        "champion_algorithm": champion_name,
        "pipeline_stages": ["SimpleImputer(median)", "StandardScaler", champion_name],
        "training_date": datetime.now(timezone.utc).isoformat(),
        "training_samples": len(df),
        "classes": {str(k.value): v for k, v in CLASS_LABELS.items()},
        "feature_schema": FEATURE_NAMES,
        "metrics": {
            "test_accuracy": round(rf_test_acc, 4),
            "macro_f1": round(rf_test_macro_f1, 4),
            "balanced_accuracy": round(rf_test_balanced_acc, 4),
            "per_class_report": class_report,
            "confusion_matrix": conf_matrix,
            "xgboost_comparison": xgb_metrics,
        },
        "data_provenance": "SYNTHETIC BENCHMARK — Calibrated Sentinel-2 Reflectance Distributions",
        "known_limitations": (
            "Model is trained on physical spectral distributions for Sentinel-2 bands B2, B3, B4, B8. "
            "For operational civil planning, regional GIS ground-truth polygon validation is recommended."
        ),
    }

    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    logger.info("Land-Cover model trained successfully. Test Macro-F1: %.4f", rf_test_macro_f1)
    return {"status": "trained", "metadata": metadata}


class LandCoverPredictor:
    """In-memory inference service for Land-Cover classification."""

    def __init__(self):
        self._model = None
        self._metadata = None
        self._load()

    def _load(self):
        if MODEL_PATH.exists():
            try:
                self._model = joblib.load(MODEL_PATH)
            except Exception as e:
                logger.error("Failed to load land cover model: %s", e)
        if METADATA_PATH.exists():
            try:
                with open(METADATA_PATH, "r", encoding="utf-8") as f:
                    self._metadata = json.load(f)
            except Exception as e:
                logger.error("Failed to load land cover metadata: %s", e)

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def metadata(self) -> dict[str, Any]:
        return self._metadata or {}

    def predict(
        self,
        features: Union[dict[str, float], list[float]],
    ) -> dict[str, Any]:
        """
        Classify land cover for a candidate observation.
        Accepts dict with keys in FEATURE_NAMES or [blue, green, red, nir].
        """
        if not self.is_loaded:
            # Lazy train if model not yet saved
            train_land_cover_model()
            self._load()

        if isinstance(features, dict):
            # If indices not present, calculate them
            if "ndvi" not in features and "band8_nir" in features and "band4_red" in features:
                indices = compute_spectral_indices(
                    features.get("band2_blue", 0.05),
                    features.get("band3_green", 0.08),
                    features.get("band4_red", 0.10),
                    features.get("band8_nir", 0.30),
                )
                vec = [indices[f] for f in FEATURE_NAMES]
            else:
                vec = [features.get(f, 0.0) for f in FEATURE_NAMES]
        else:
            if len(features) == 4:
                # [blue, green, red, nir]
                indices = compute_spectral_indices(features[0], features[1], features[2], features[3])
                vec = [indices[f] for f in FEATURE_NAMES]
            elif len(features) == len(FEATURE_NAMES):
                vec = list(features)
            else:
                raise ValueError(f"Expected 4 or {len(FEATURE_NAMES)} features, got {len(features)}")

        # Out-of-distribution / quality flag verification
        b2 = vec[0]
        b4 = vec[2]
        b8 = vec[3]
        if all(abs(v) < 1e-5 for v in vec[:4]):
            quality_flag = "zero_signal"
        elif any(v < -0.05 or v > 1.25 for v in [b2, b4, b8]):
            quality_flag = "out_of_distribution"
        else:
            quality_flag = "nominal"

        # Pass DataFrame with FEATURE_NAMES so StandardScaler preserves exact schema names
        df_in = pd.DataFrame([vec], columns=FEATURE_NAMES)
        pred_class = int(self._model.predict(df_in)[0])
        probabilities = self._model.predict_proba(df_in)[0]

        probs_dict = {
            CLASS_LABELS[LandCoverClass(i)]: round(float(p), 4)
            for i, p in enumerate(probabilities)
        }
        confidence = float(np.max(probabilities))

        return {
            "predicted_class_id": pred_class,
            "predicted_class_name": CLASS_LABELS.get(pred_class, "Unknown"),
            "probabilities": probs_dict,
            "confidence": round(confidence, 4),
            "quality_flag": quality_flag,
            "model_version": self._metadata.get("model_version", "2.1.0-rf-sentinel2") if self._metadata else "2.1.0-rf-sentinel2",
            "data_status": "synthetic_benchmark",
            "provenance": "ML PREDICTION (Sentinel-2 Spectral Random Forest)",
            "input_features": {FEATURE_NAMES[i]: round(vec[i], 4) for i in range(len(vec))},
        }

    def classify_cell_spectral(self, green_space_ratio: float, built_surface_ratio: float) -> dict[str, Any]:
        """
        Synthesize calibrated reflectance proxy for a cell and run spectral classification.
        Used to connect land-cover classification into spatial grid pipelines.
        """
        # Synthesize realistic surface reflectance proxies
        if green_space_ratio >= 0.50:
            # Vegetation dominated
            b2, b3, b4, b8 = 0.03, 0.07, 0.04, 0.48
        elif built_surface_ratio >= 0.50:
            # Built-up dominated
            b2, b3, b4, b8 = 0.14, 0.17, 0.22, 0.24
        elif green_space_ratio < 0.20 and built_surface_ratio < 0.30:
            # Bare soil / transitional ground
            b2, b3, b4, b8 = 0.12, 0.18, 0.30, 0.35
        else:
            # Mixed urban
            b2, b3, b4, b8 = 0.09, 0.13, 0.15, 0.32

        return self.predict([b2, b3, b4, b8])


# Singleton instance
land_cover_predictor = LandCoverPredictor()
