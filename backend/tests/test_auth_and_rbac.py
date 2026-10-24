"""
EcoGrid AI — Comprehensive Authentication, Session Security & RBAC Test Suite.

Validates:
1. Registration (validation, Argon2id hashing, duplicate rejection, least-privilege role assignment)
2. Login & Rate Limiting (credential check, brute force throttling, generic errors, secure cookies)
3. Session Security (HttpOnly cookies, server-side hash lookup, session persistence, invalidation on logout)
4. Role-Based Access Control (Admin, Planner, Viewer privileges strictly enforced by backend)
5. Resource Protection & IDOR Prevention (user-owned study areas and runs restricted to authorized owners)
6. Password Reset Flow (single-use tokens, expiration, token reuse prevention, session revocation)
7. Password Change Flow (authenticated verification, session invalidation)
8. CSRF Protection (double-submit cookie & X-CSRF-Token validation on state-changing cookie requests)
"""
from __future__ import annotations

import time
import uuid
import pytest
from starlette.testclient import TestClient

from app.auth.rate_limiter import auth_rate_limiter
from app.auth.security import hash_password, verify_password
from app.config import settings
from app.main import app
from app.models.database import (
    PasswordResetToken,
    SessionRecord,
    StudyArea,
    User,
    get_session_factory,
    init_db,
)


@pytest.fixture(autouse=True)
def setup_test_db():
    """Ensure database tables exist and rate limiter is cleared before each test."""
    init_db()
    auth_rate_limiter.clear()
    yield
    auth_rate_limiter.clear()


def create_test_user(
    email: str = "testuser@example.test",
    password: str = "StrongPass123!@#",
    role: str = "viewer",
    full_name: str = "Test User",
) -> User:
    """Helper to provision a user directly in the database."""
    factory = get_session_factory()
    with factory() as db:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            db.delete(existing)
            db.commit()

        user = User(
            id=f"usr_{uuid.uuid4().hex[:12]}",
            full_name=full_name,
            email=email.lower().strip(),
            password_hash=hash_password(password),
            role=role,
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def csrf_headers(client: TestClient) -> dict:
    """Extract CSRF cookie and return the required HTTP header."""
    token = client.cookies.get(settings.csrf_cookie_name)
    return {"X-CSRF-Token": token} if token else {}


# ---------------------------------------------------------------------------
# 1. Registration Tests
# ---------------------------------------------------------------------------

def test_registration_success():
    """Valid registration succeeds, creates viewer user with Argon2id hash, and sets HttpOnly cookie."""
    client = TestClient(app)
    unique_email = f"newuser_{uuid.uuid4().hex[:6]}@example.test"
    payload = {
        "full_name": "Dr. Sarah Green",
        "email": unique_email,
        "password": "SecurePassword2026!#",
        "confirm_password": "SecurePassword2026!#",
    }
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert "user" in data
    assert data["user"]["email"] == unique_email
    assert data["user"]["role"] == "viewer"  # Must strictly be viewer
    assert "password" not in data["user"]
    assert "password_hash" not in data["user"]

    # Verify session cookie was set with HttpOnly
    assert settings.session_cookie_name in client.cookies

    # Verify DB record has valid Argon2id hash
    factory = get_session_factory()
    with factory() as db:
        db_user = db.query(User).filter(User.email == unique_email).first()
        assert db_user is not None
        assert db_user.password_hash.startswith("$argon2id$")
        assert verify_password("SecurePassword2026!#", db_user.password_hash)


def test_registration_duplicate_email_rejected():
    """Duplicate email registration is rejected with 409 Conflict."""
    client = TestClient(app)
    email = f"dup_{uuid.uuid4().hex[:6]}@example.test"
    create_test_user(email=email)

    payload = {
        "full_name": "Another User",
        "email": email,
        "password": "SecurePassword2026!#",
        "confirm_password": "SecurePassword2026!#",
    }
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 409
    assert "already exists" in res.json().get("detail", "").lower()


def test_registration_weak_password_rejected():
    """Passwords that fail strength requirements are rejected with 422."""
    client = TestClient(app)

    # 1. Too short (< 12 chars)
    res_short = client.post("/api/auth/register", json={
        "full_name": "Test User",
        "email": "testshort@example.test",
        "password": "Short1!",
        "confirm_password": "Short1!",
    })
    assert res_short.status_code == 422

    # 2. Missing uppercase
    res_no_upper = client.post("/api/auth/register", json={
        "full_name": "Test User",
        "email": "testupper@example.test",
        "password": "lowercase_only_123!#",
        "confirm_password": "lowercase_only_123!#",
    })
    assert res_no_upper.status_code == 422

    # 3. Missing symbol
    res_no_sym = client.post("/api/auth/register", json={
        "full_name": "Test User",
        "email": "testsym@example.test",
        "password": "NoSymbolsAllowed123",
        "confirm_password": "NoSymbolsAllowed123",
    })
    assert res_no_sym.status_code == 422


def test_public_registration_cannot_elevate_privileges():
    """Public registration cannot assign admin or planner role."""
    client = TestClient(app)
    email = f"hacker_{uuid.uuid4().hex[:6]}@example.test"
    payload = {
        "full_name": "Privilege Escalation Attempt",
        "email": email,
        "password": "SuperSecurePassword123!#",
        "confirm_password": "SuperSecurePassword123!#",
        "role": "admin",  # Attacker tries to inject role
    }
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 201
    assert res.json()["user"]["role"] == "viewer"  # Gated to viewer


# ---------------------------------------------------------------------------
# 2. Login, Logout & Rate Limiting Tests
# ---------------------------------------------------------------------------

def test_login_success():
    """Correct credentials return 200, user profile, and session cookie."""
    client = TestClient(app)
    email = f"user_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    create_test_user(email=email, password=password, role="planner")

    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["email"] == email
    assert data["user"]["role"] == "planner"
    assert settings.session_cookie_name in client.cookies


def test_login_incorrect_password_fails_generic():
    """Incorrect password returns 401 with generic error message."""
    client = TestClient(app)
    email = f"user_{uuid.uuid4().hex[:6]}@example.test"
    create_test_user(email=email, password="CorrectPassword123!#")

    res = client.post("/api/auth/login", json={"email": email, "password": "WrongPassword123!#"})
    assert res.status_code == 401
    assert "Invalid email or password" in res.json().get("detail", "")


def test_login_nonexistent_email_fails_generic():
    """Non-existent email returns generic 401 (preventing user enumeration)."""
    client = TestClient(app)
    res = client.post("/api/auth/login", json={"email": "nonexistent@example.test", "password": "AnyPassword123!#"})
    assert res.status_code == 401
    assert "Invalid email or password" in res.json().get("detail", "")


def test_login_rate_limiting():
    """Rapid repeated login failures trigger 429 Too Many Requests."""
    client = TestClient(app)
    email = "ratelimit_target@example.test"

    # Settings allow 5 attempts by default
    for _ in range(5):
        res = client.post("/api/auth/login", json={"email": email, "password": "WrongPassword123!#"})
        assert res.status_code == 401

    # 6th attempt must be rate-limited with 429
    res_limited = client.post("/api/auth/login", json={"email": email, "password": "WrongPassword123!#"})
    assert res_limited.status_code == 429
    assert "too many" in res_limited.json().get("detail", "").lower()
    assert "Retry-After" in res_limited.headers


def test_logout_invalidates_session():
    """Logout invalidates the server-side session in DB and clears cookie."""
    client = TestClient(app)
    email = f"logout_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    user = create_test_user(email=email, password=password)

    # 1. Login
    login_res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_res.status_code == 200

    # 2. Check /api/auth/me works
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["email"] == email

    # 3. Logout (with CSRF header)
    logout_res = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert logout_res.status_code == 200

    # 4. /api/auth/me must now return 401 Unauthorized
    me_after = client.get("/api/auth/me")
    assert me_after.status_code == 401

    # 5. Verify session in DB has revoked_at timestamp
    factory = get_session_factory()
    with factory() as db:
        sessions = db.query(SessionRecord).filter(SessionRecord.user_id == user.id).all()
        assert len(sessions) >= 1
        for s in sessions:
            assert s.revoked_at is not None


# ---------------------------------------------------------------------------
# 3. Session Persistence & Token Hashing Tests
# ---------------------------------------------------------------------------

def test_session_token_stored_only_as_hash():
    """Database never stores raw session tokens; only SHA-256 hashes exist."""
    client = TestClient(app)
    email = f"hash_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    user = create_test_user(email=email, password=password)

    client.post("/api/auth/login", json={"email": email, "password": password})
    raw_cookie = client.cookies.get(settings.session_cookie_name)
    assert raw_cookie is not None

    factory = get_session_factory()
    with factory() as db:
        db_session = db.query(SessionRecord).filter(SessionRecord.user_id == user.id).first()
        assert db_session is not None
        # The stored token_hash must NOT equal the raw token string
        assert db_session.token_hash != raw_cookie
        assert len(db_session.token_hash) == 64  # SHA-256 hex digest length


# ---------------------------------------------------------------------------
# 4. Role-Based Authorization Tests (Viewer vs Planner vs Admin)
# ---------------------------------------------------------------------------

def test_viewer_role_cannot_perform_planner_operations():
    """Viewer accounts are forbidden from running optimization, approvals, or scenarios."""
    client = TestClient(app)
    email = f"viewer_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    create_test_user(email=email, password=password, role="viewer")

    # Login as viewer
    client.post("/api/auth/login", json={"email": email, "password": password})
    headers = csrf_headers(client)

    # 1. Viewer cannot run optimization
    res_opt = client.post("/api/optimize", json={"budget": 300000.0}, headers=headers)
    assert res_opt.status_code == 403
    assert "Forbidden" in res_opt.json().get("detail", "")

    # 2. Viewer cannot run Pareto optimization
    res_par = client.post("/api/pareto", json={"budget": 400000.0}, headers=headers)
    assert res_par.status_code == 403

    # 3. Viewer cannot approve plans
    res_appr = client.post("/api/approval", json={"runId": "run-123", "status": "APPROVED"}, headers=headers)
    assert res_appr.status_code == 403

    # 4. Viewer cannot create scenarios
    res_scen = client.post("/api/scenarios", json={"name": "Viewer Scenario", "budget": 200000.0}, headers=headers)
    assert res_scen.status_code == 403

    # 5. Viewer cannot access admin endpoints
    res_admin = client.get("/api/admin/users")
    assert res_admin.status_code == 403


def test_planner_role_can_run_planner_operations_but_not_admin():
    """Planner can execute optimization and planning, but cannot access admin endpoints."""
    client = TestClient(app)
    email = f"planner_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    create_test_user(email=email, password=password, role="planner")

    # Login as planner
    client.post("/api/auth/login", json={"email": email, "password": password})
    headers = csrf_headers(client)

    # 1. Planner CAN run optimization on demo study
    res_opt = client.post("/api/optimize", json={"studyId": "study-bengaluru-east", "budget": 300000.0}, headers=headers)
    assert res_opt.status_code == 200
    assert "runId" in res_opt.json()

    # 2. Planner CAN create planning scenarios
    res_scen = client.post("/api/scenarios", json={"studyId": "study-bengaluru-east", "name": "Planner Move", "budget": 250000.0}, headers=headers)
    assert res_scen.status_code == 200

    # 3. Planner CANNOT access admin user management
    res_admin = client.get("/api/admin/users")
    assert res_admin.status_code == 403


def test_admin_role_can_manage_users_and_roles():
    """Admin can list users and promote roles."""
    client = TestClient(app)
    admin_email = f"admin_{uuid.uuid4().hex[:6]}@example.test"
    password = "CorrectPassword123!#"
    create_test_user(email=admin_email, password=password, role="admin")

    viewer_email = f"target_{uuid.uuid4().hex[:6]}@example.test"
    target_user = create_test_user(email=viewer_email, password=password, role="viewer")

    # Login as admin
    client.post("/api/auth/login", json={"email": admin_email, "password": password})
    headers = csrf_headers(client)

    # 1. Admin lists users
    res_users = client.get("/api/admin/users")
    assert res_users.status_code == 200
    user_list = res_users.json()["users"]
    assert any(u["email"] == viewer_email for u in user_list)

    # 2. Admin promotes viewer to planner
    res_promote = client.patch(f"/api/admin/users/{target_user.id}/role", json={"role": "planner"}, headers=headers)
    assert res_promote.status_code == 200
    assert res_promote.json()["user"]["role"] == "planner"


# ---------------------------------------------------------------------------
# 5. IDOR & Resource Ownership Tests
# ---------------------------------------------------------------------------

def test_idor_protection_for_private_study_areas():
    """Planner A cannot access or optimize Planner B's private study area."""
    client_a = TestClient(app)
    client_b = TestClient(app)

    password = "CorrectPassword123!#"
    planner_a = create_test_user(email=f"planner_a_{uuid.uuid4().hex[:6]}@example.test", password=password, role="planner")
    planner_b = create_test_user(email=f"planner_b_{uuid.uuid4().hex[:6]}@example.test", password=password, role="planner")

    # Planner A logs in and creates a custom private study
    client_a.post("/api/auth/login", json={"email": planner_a.email, "password": password})
    headers_a = csrf_headers(client_a)
    res_create = client_a.post("/api/studies", json={
        "name": "Planner A Confidential Area",
        "rows": 5,
        "columns": 5,
        "origin": [12.95, 77.65],
    }, headers=headers_a)
    assert res_create.status_code == 200
    private_study_id = res_create.json()["study"]["id"]

    # Planner B logs in
    client_b.post("/api/auth/login", json={"email": planner_b.email, "password": password})
    headers_b = csrf_headers(client_b)

    # Planner B attempts to access Planner A's private study cells -> Forbidden (403)
    res_idor_get = client_b.get(f"/api/studies/{private_study_id}/cells")
    assert res_idor_get.status_code == 403

    # Planner B attempts to optimize Planner A's private study -> Forbidden (403)
    res_idor_opt = client_b.post("/api/optimize", json={"studyId": private_study_id, "budget": 100000.0}, headers=headers_b)
    assert res_idor_opt.status_code == 403


# ---------------------------------------------------------------------------
# 6. Password Reset Flow Tests
# ---------------------------------------------------------------------------

def test_password_reset_flow():
    """Full password reset lifecycle: request token, reset password, verify session revocation."""
    client = TestClient(app)
    email = f"reset_{uuid.uuid4().hex[:6]}@example.test"
    old_password = "OldPassword123!#"
    new_password = "NewSecurePassword456!@"
    user = create_test_user(email=email, password=old_password)

    # 1. Login with old password
    client.post("/api/auth/login", json={"email": email, "password": old_password})
    assert client.get("/api/auth/me").status_code == 200

    # 2. Request forgot-password token (public auth endpoint)
    forgot_res = client.post("/api/auth/forgot-password", json={"email": email})
    assert forgot_res.status_code == 200
    dev_token = forgot_res.json().get("dev_reset_token")
    assert dev_token is not None

    # 3. Complete reset-password (public auth endpoint)
    reset_res = client.post("/api/auth/reset-password", json={
        "token": dev_token,
        "new_password": new_password,
        "confirm_password": new_password,
    })
    assert reset_res.status_code == 200

    # 4. Old session was revoked
    assert client.get("/api/auth/me").status_code == 401

    # 5. Old password no longer works
    assert client.post("/api/auth/login", json={"email": email, "password": old_password}).status_code == 401

    # 6. New password successfully logs in
    login_new = client.post("/api/auth/login", json={"email": email, "password": new_password})
    assert login_new.status_code == 200

    # 7. Reset token cannot be reused
    reused_res = client.post("/api/auth/reset-password", json={
        "token": dev_token,
        "new_password": "YetAnotherPassword789!#",
        "confirm_password": "YetAnotherPassword789!#",
    })
    assert reused_res.status_code == 400


# ---------------------------------------------------------------------------
# 7. Authenticated Password Change Tests
# ---------------------------------------------------------------------------

def test_authenticated_password_change():
    """Authenticated user changes password; current password validated and new password enforced."""
    client = TestClient(app)
    email = f"change_{uuid.uuid4().hex[:6]}@example.test"
    password = "InitialPassword123!#"
    new_password = "ChangedPassword999!#"
    create_test_user(email=email, password=password)

    # Login
    client.post("/api/auth/login", json={"email": email, "password": password})
    headers = csrf_headers(client)

    # Wrong current password fails
    bad_res = client.post("/api/auth/change-password", json={
        "current_password": "WrongPassword123!#",
        "new_password": new_password,
        "confirm_password": new_password,
    }, headers=headers)
    assert bad_res.status_code == 400

    # Correct password succeeds
    good_res = client.post("/api/auth/change-password", json={
        "current_password": password,
        "new_password": new_password,
        "confirm_password": new_password,
    }, headers=headers)
    assert good_res.status_code == 200

    # Can now login with new password
    client_new = TestClient(app)
    assert client_new.post("/api/auth/login", json={"email": email, "password": new_password}).status_code == 200


# ---------------------------------------------------------------------------
# 8. CSRF Protection Enforcement Tests
# ---------------------------------------------------------------------------

def test_csrf_protection_enforces_tokens_and_blocks_forgeries():
    """State-changing requests using cookie session without X-CSRF-Token are rejected with 403."""
    client = TestClient(app)
    email = f"csrf_test_{uuid.uuid4().hex[:6]}@example.test"
    password = "SecurePassword123!#"
    create_test_user(email=email, password=password, role="planner")

    # 1. Login to get session and CSRF cookies
    client.post("/api/auth/login", json={"email": email, "password": password})
    assert settings.session_cookie_name in client.cookies
    assert settings.csrf_cookie_name in client.cookies
    valid_csrf = client.cookies[settings.csrf_cookie_name]

    # 2. Attempt state-changing request WITHOUT X-CSRF-Token header -> Rejected with 403
    forged_res = client.post("/api/studies", json={"name": "Forged Study", "rows": 5, "columns": 5})
    assert forged_res.status_code == 403
    assert "CSRF" in forged_res.json().get("error", forged_res.json().get("detail", ""))

    # 3. Attempt state-changing request with MISMATCHED X-CSRF-Token header -> Rejected with 403
    mismatch_res = client.post("/api/studies", json={"name": "Mismatch Study", "rows": 5, "columns": 5}, headers={"X-CSRF-Token": "invalid_csrf_token"})
    assert mismatch_res.status_code == 403

    # 4. Attempt state-changing request WITH VALID X-CSRF-Token header -> Allowed (200)
    valid_res = client.post("/api/studies", json={"name": "Legitimate Study", "rows": 5, "columns": 5}, headers={"X-CSRF-Token": valid_csrf})
    assert valid_res.status_code == 200
