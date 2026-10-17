# EcoGrid model service

A FastAPI service the EcoGrid API calls to fetch per-cell scores and confidence.
`main.py` ships a deterministic **stub** (a heuristic, not a trained model) so the whole pipeline works
end to end. Swap in your trained model by editing `load_model()` and `predict_cell()` only.

## Contract

`POST /predict`
```json
{ "studyId": "study-bengaluru-east", "cells": [{ "id": "A01", "row": 0, "col": 0, "lat": 12.93, "lng": 77.62,
  "landUse": "plaza", "surfaceType": "paved", "existingGreenCover": 0.1, "capacity": 4 }] }
```
returns
```json
{ "modelVersion": "stub-0.1.0", "predictions": [{ "id": "A01", "heat": 0.7, "vegetation": 0.8, "pedestrian": 0.6,
  "connectivity": 0.5, "confidence": 0.82, "lower": 0.65, "upper": 0.75 }] }
```
All values are 0-1. Every score/confidence field except `id` is optional; omitted fields keep their current value.
`GET /health` returns `{ "ok": true, "modelVersion": "..." }`.
If `MODEL_API_KEY` is set, requests must send `Authorization: Bearer <key>`.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Then start the EcoGrid API with `MODEL_URL=http://localhost:8000` (and the same `MODEL_API_KEY` if you set one).
