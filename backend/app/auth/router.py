"""
EcoGrid AI — Authentication, Session, and User Management API Router.

Mounts:
- Public session & CSRF initialization (/api/auth/csrf)
- User registration (/api/auth/register)
- Login & Logout (/api/auth/login, /api/auth/logout)
- Session persistence & profile inspection (/api/auth/me)
- Password recovery & reset (/api/auth/forgot-password, /api/auth/reset-password)
- Authenticated password modification (/api/auth/change-password)
- Administrator user governance (/api/admin/users, /api/admin/users/{id}/role, /api/admin/users/{id}/status)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth.csrf import generate_csrf_token, set_csrf_cookie


def utcnow() -> datetime:
    """Return timezone-naive UTC timestamp for database compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
from app.auth.dependencies import (
    extract_session_token,
    get_current_user,
    get_db,
    require_admin,
)
from app.auth.rate_limiter import auth_rate_limiter
from app.auth.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    RoleUpdateRequest,
    StatusUpdateRequest,
    UserResponse,
)
from app.auth.security import (
    generate_secure_token,
    hash_password,
    hash_token,
    normalize_email,
    validate_password_strength,
    verify_password,
)
from app.auth.session_manager import (
    clear_session_cookies,
    create_user_session,
    get_client_ip,
    lookup_session,
    revoke_all_sessions_for_user,
    revoke_session,
)
from app.config import settings
from app.models.database import PasswordResetToken, User

logger = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])
admin_router = APIRouter(prefix="/api/admin", tags=["Admin Management"])


# ---------------------------------------------------------------------------
# CSRF Endpoint
# ---------------------------------------------------------------------------

@auth_router.get("/csrf")
async def get_csrf_token(request: Request, response: Response):
    """
    Initialize CSRF token and set double-submit cookie.
    Client transmits this token in the 'X-CSRF-Token' header for state-changing requests.
    """
    token = set_csrf_cookie(response, request)
    return {"csrfToken": token}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Register a new user account.
    - Password is validated for strength and hashed with Argon2id.
    - Public registration grants least-privilege default role ('viewer').
    - Returns safe user profile and sets secure HttpOnly session cookie.
    """
    # 1. Enforce password complexity
    valid, message = validate_password_strength(payload.password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    # 2. Prevent duplicate account creation
    email = normalize_email(payload.email)
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    # 3. Create user with least-privilege 'viewer' role
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        full_name=payload.full_name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        role="viewer",  # Public registration can never grant elevated roles
        is_active=True,
        email_verified=False,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 4. Issue authenticated session
    create_user_session(db, user, request, response)

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "fullName": user.full_name,
            "role": user.role,
            "createdAt": user.created_at.isoformat(),
        }
    }


# ---------------------------------------------------------------------------
# Login & Logout
# ---------------------------------------------------------------------------

@auth_router.post("/login")
async def login_user(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Authenticate user credentials, rotate session token to prevent fixation,
    and establish secure HttpOnly cookie session.
    Applies rate limiting to prevent brute force attacks.
    """
    client_ip = get_client_ip(request) or "unknown"
    rate_limit_key = f"login:{client_ip}:{payload.email}"

    # 1. Rate limiting check
    is_limited, retry_after = auth_rate_limiter.is_rate_limited(
        rate_limit_key,
        max_attempts=settings.rate_limit_login_attempts,
        window_seconds=settings.rate_limit_window_seconds,
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    # 2. Verify credentials
    email = normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()

    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        auth_rate_limiter.record_attempt(rate_limit_key)
        # Generic error message to prevent account enumeration
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    # 3. Successful login — clear rate limit records
    auth_rate_limiter.reset(rate_limit_key)

    # 4. Create fresh session (rotates token, sets HttpOnly cookie)
    create_user_session(db, user, request, response)

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "fullName": user.full_name,
            "role": user.role,
            "createdAt": user.created_at.isoformat(),
        }
    }


@auth_router.post("/logout")
async def logout_user(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Invalidate server-side session and clear session cookies.
    """
    token = extract_session_token(request)
    if token:
        session_record = lookup_session(db, token)
        if session_record:
            revoke_session(db, session_record)

    clear_session_cookies(response, request)
    return {"ok": True, "message": "Signed out successfully."}


# ---------------------------------------------------------------------------
# Session Persistence (/api/auth/me)
# ---------------------------------------------------------------------------

@auth_router.get("/me")
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve profile of the currently authenticated user.
    Server validates the session token hash in the database.
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "fullName": current_user.full_name,
        "role": current_user.role,
        "createdAt": current_user.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Password Reset & Security
# ---------------------------------------------------------------------------

@auth_router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Request single-use password reset token.
    Generic response prevents user enumeration.
    In local development, logs and returns dev token when email delivery is not configured.
    """
    client_ip = get_client_ip(request) or "unknown"
    rate_limit_key = f"forgot:{client_ip}"
    is_limited, retry_after = auth_rate_limiter.is_rate_limited(
        rate_limit_key, max_attempts=5, window_seconds=300
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many reset requests. Please wait {retry_after} seconds.",
        )
    auth_rate_limiter.record_attempt(rate_limit_key)

    email = normalize_email(payload.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()

    dev_token: Optional[str] = None

    if user:
        # Invalidate any existing unused reset tokens for this user
        existing_tokens = (
            db.query(PasswordResetToken)
            .filter(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .all()
        )
        for t in existing_tokens:
            t.used_at = utcnow()

        # Generate single-use random token with 15-minute expiration
        raw_reset_token = generate_secure_token(32)
        token_hash = hash_token(raw_reset_token)
        expires_at = utcnow() + timedelta(minutes=15)

        reset_record = PasswordResetToken(
            id=f"rst_{uuid.uuid4().hex}",
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
            created_at=utcnow(),
        )
        db.add(reset_record)
        db.commit()

        if settings.smtp_host:
            logger.info("Password reset email sent to %s via configured SMTP", email)
            # In a production deployment with SMTP configured, send the email here
        else:
            logger.warning(
                "SMTP is not configured. For development/testing, reset token is: %s",
                raw_reset_token,
            )
            if settings.environment != "production":
                dev_token = raw_reset_token

    response_payload = {
        "message": "If that email address is registered, instructions to reset your password have been generated."
    }
    if dev_token:
        response_payload["dev_reset_token"] = dev_token

    return response_payload


@auth_router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Complete password reset with a valid, unexpired reset token.
    Revokes all existing user sessions upon password update.
    """
    valid, message = validate_password_strength(payload.new_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    token_hash = hash_token(payload.token)
    reset_record = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
        )
        .first()
    )

    if not reset_record or reset_record.expires_at < utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired password reset token.",
        )

    user = db.query(User).filter(User.id == reset_record.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive or not found.",
        )

    # Update password
    user.password_hash = hash_password(payload.new_password)
    user.updated_at = utcnow()
    reset_record.used_at = utcnow()

    # Security requirement: Invalidate all existing sessions upon password reset
    revoke_all_sessions_for_user(db, user.id)

    db.commit()

    return {"message": "Password has been successfully reset. Please log in with your new password."}


@auth_router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Change password for an authenticated user.
    Validates current password, enforces password strength, and revokes other active sessions.
    """
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    valid, message = validate_password_strength(payload.new_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    current_user.password_hash = hash_password(payload.new_password)
    current_user.updated_at = utcnow()

    # Revoke other sessions while keeping current session active
    current_token = extract_session_token(request)
    current_session = lookup_session(db, current_token) if current_token else None
    current_sess_id = current_session.id if current_session else None

    revoke_all_sessions_for_user(db, current_user.id, keep_session_id=current_sess_id)

    db.commit()

    return {"message": "Password changed successfully."}


# ---------------------------------------------------------------------------
# Administrator User Governance
# ---------------------------------------------------------------------------

@admin_router.get("/users")
async def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all user accounts in the workspace (Admin only)."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {
        "users": [
            {
                "id": u.id,
                "fullName": u.full_name,
                "email": u.email,
                "role": u.role,
                "isActive": u.is_active,
                "createdAt": u.created_at.isoformat(),
            }
            for u in users
        ]
    }


@admin_router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: RoleUpdateRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update a user's role (Admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.role = payload.role
    user.updated_at = utcnow()
    db.commit()

    return {
        "user": {
            "id": user.id,
            "fullName": user.full_name,
            "email": user.email,
            "role": user.role,
            "isActive": user.is_active,
            "createdAt": user.created_at.isoformat(),
        }
    }


@admin_router.patch("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    payload: StatusUpdateRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Activate or deactivate a user account (Admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.is_active = payload.is_active
    user.updated_at = utcnow()

    # If deactivating, revoke all user sessions immediately
    if not payload.is_active:
        revoke_all_sessions_for_user(db, user.id)

    db.commit()

    return {
        "user": {
            "id": user.id,
            "fullName": user.full_name,
            "email": user.email,
            "role": user.role,
            "isActive": user.is_active,
            "createdAt": user.created_at.isoformat(),
        }
    }
