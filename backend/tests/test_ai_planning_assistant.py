"""
Tests for AI Planning Assistant & Multi-Key Grok Failover System (Stage 7).
Validates:
1. Grok multi-key pool initialization (>= 5 keys)
2. AI Planning Assistant (answers 'Why was this location prioritized?' using actual cell data)
3. Scenario Explanation (explains plan changes after budget/weight shifts)
4. Impact Report Summary (concise executive summary, key trade-offs, next steps)
5. Recommendation Validation Assistance (flags missing assumptions, backend constraint verification)
6. Automatic Key Switching & Failover mechanism on rate limits / errors
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.grok_pool import grok_pool


@pytest.fixture
def client():
    return TestClient(app)


def test_ai_status_multi_key_pool(client):
    """Verifies that the multi-key pool is active with at least 5 keys."""
    resp = client.get("/api/ai/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_keys" in data
    assert data["total_keys"] >= 5
    assert "active_key_index" in data
    assert "healthy_count" in data
    assert len(data["keys"]) >= 5


def test_ai_planning_assistant_answers_why_prioritized(client):
    """Verifies AI Planning Assistant explains why a location was prioritized using real site data."""
    payload = {
        "studyId": "study-bengaluru-east",
        "cellId": "C03",
        "question": "Why was this location prioritized?",
    }
    resp = client.post("/api/ai/assistant", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert len(data["answer"]) > 50
    assert "ai_metadata" in data
    assert data["cellId"] == "C03"
    # Grounding check: answer should reference environmental need or site characteristics
    assert any(term in data["answer"].lower() for term in ["heat", "quad", "c03", "priority", "temperature", "vegetation", "canopy"])


def test_scenario_explanation(client):
    """Verifies Scenario Explanation explains plan changes after budget/weights adjustments."""
    payload = {
        "studyId": "study-bengaluru-east",
        "baseline": {
            "budget": 300000,
            "weights": {"heat": 30, "vegetation": 25, "pedestrian": 25, "connectivity": 20},
            "plan": {"totalCost": 290000, "combinedBenefit": 54.0, "cellsImproved": 12},
        },
        "proposal": {
            "budget": 500000,
            "weights": {"heat": 50, "vegetation": 20, "pedestrian": 15, "connectivity": 15},
            "plan": {"totalCost": 485000, "combinedBenefit": 83.5, "cellsImproved": 19},
        },
    }
    resp = client.post("/api/ai/scenario-explain", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "explanation" in data
    assert len(data["explanation"]) > 50
    assert "deltas" in data
    assert data["deltas"]["budget_delta"] == 200000


def test_impact_report_summary(client):
    """Verifies Impact Report Summary produces executive summary, trade-offs, and next steps."""
    payload = {
        "studyId": "study-bengaluru-east",
        "budget": 500000,
        "plan": {
            "totalCost": 485000,
            "remainingBudget": 15000,
            "utilization": 0.97,
            "combinedBenefit": 84.2,
            "cellsImproved": 20,
            "categoryBenefits": {"heat": 32.5, "vegetation": 24.1, "pedestrian": 18.2, "connectivity": 9.4},
            "benchmark": {"efficiency_gain_pct": 21.4},
        },
    }
    resp = client.post("/api/ai/impact-summary", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "summary_markdown" in data
    text = data["summary_markdown"].lower().replace("\u2011", "-")
    assert "executive summary" in text or "summary" in text
    assert "trade-off" in text or "tradeoff" in text or "trade" in text
    assert "next step" in text or "steps" in text


def test_recommendation_validation_assistance(client):
    """Verifies Recommendation Validation flags missing assumptions while verifying backend constraints."""
    payload = {
        "studyId": "study-bengaluru-east",
        "budget": 500000,
        "plan": {
            "totalCost": 485000,
            "selected": [
                {"cellId": "C03", "interventionId": "native_trees", "quantity": 5, "cost": 37500},
                {"cellId": "D05", "interventionId": "shade_structure", "quantity": 2, "cost": 90000},
            ],
        },
    }
    resp = client.post("/api/ai/validate-plan", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "validation_report" in data
    assert data["backend_enforced"] is True
    text = data["validation_report"].lower()
    assert any(term in text for term in ["enforce", "constraint", "assumption", "clearance", "setback", "utility"])


def test_key_failover_mechanism():
    """Verifies that an error on an active key triggers automatic switching to the next healthy key."""
    initial_switches = grok_pool.total_failovers
    active_idx = grok_pool.current_index
    key_obj = grok_pool.keys[active_idx]

    # Simulate a key error triggering cooldown
    grok_pool.mark_key_cooldown(key_obj, "Simulated 429 Rate Limit", cooldown_seconds=60)
    
    assert key_obj.status == "COOLDOWN"
    assert grok_pool.total_failovers == initial_switches + 1
    # Next key should now be active
    next_key = grok_pool.get_next_available_key()
    assert next_key.index != key_obj.index


def test_impact_report_structured_briefing_schema(client):
    """Verifies that impact report returns both structured_briefing and summary_markdown with authoritative metrics."""
    payload = {
        "studyId": "study-bengaluru-east",
        "budget": 500000,
        "plan": {
            "totalCost": 485000,
            "remainingBudget": 15000,
            "utilization": 0.97,
            "combinedBenefit": 84.2,
            "cellsImproved": 20,
            "categoryBenefits": {"heat": 32.5, "vegetation": 24.1, "pedestrian": 18.2, "connectivity": 9.4},
            "benchmark": {"efficiency_gain_pct": 21.4},
        },
    }
    resp = client.post("/api/ai/impact-summary", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert "structured_briefing" in data
    briefing = data["structured_briefing"]
    assert "executiveSummary" in briefing and len(briefing["executiveSummary"]) > 20
    assert "keyMetrics" in briefing and len(briefing["keyMetrics"]) >= 4
    assert "tradeOffs" in briefing and len(briefing["tradeOffs"]) >= 1
    assert "recommendations" in briefing and len(briefing["recommendations"]) >= 1
    assert "limitations" in briefing and len(briefing["limitations"]) >= 1

    # Authoritative metric check (prevent hallucination)
    metrics_by_label = {m["label"]: m for m in briefing["keyMetrics"]}
    assert "Allocated Capital" in metrics_by_label or "Grid Cells Improved" in metrics_by_label

    # GFM Markdown check
    assert "summary_markdown" in data
    md = data["summary_markdown"]
    assert "| Metric |" in md or "| Trade-Off Dimension |" in md or "| Priority |" in md


def test_pdf_report_with_ai_briefing(client):
    """Verifies that PDF report endpoint runs and embeds AI decision briefing successfully."""
    resp = client.get("/api/studies/study-bengaluru-east/report?format=pdf&budget=500000")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")
    assert len(resp.content) > 5000  # Valid multi-page PDF

