"""
EcoGrid AI — Authentication & Authorization FastAPI Dependencies.

Provides reusable dependencies for:
- Database session lifecycle
- Current authenticated user extraction from secure HttpOnly session cookie
- Role-based access control (Admin, Planner, Viewer)
- Resource ownership validation (IDOR prevention)
"""
from __future__ import annotations

from typing import Callable, List, Optional
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth.session_manager import lookup_session
from app.config import settings
from app.models.database import SessionRecord, StudyArea, User, get_session_factory


def get_db() -> Session:
    """Yield a database session and ensure clean closure."""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


def extract_session_token(request: Request) -> Optional[str]:
    """
    Extract session token from HttpOnly cookie, with support for
    Bearer authorization header for programmatic API testing.
    """
    # 1. Primary: HttpOnly session cookie
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        return token.strip()

    # 2. Secondary: Bearer authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer_val = auth_header[7:].strip()
        if bearer_val:
            return bearer_val

    return None


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    Retrieve currently authenticated user if a valid session exists.
    Returns None if unauthenticated or session is expired/revoked.
    Does not raise an exception.
    """
    token = extract_session_token(request)
    if not token:
        return None

    session_record = lookup_session(db, token)
    if not session_record:
        return None

    user = db.query(User).filter(User.id == session_record.user_id).first()
    if not user or not user.is_active:
        return None

    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """
    Enforce authentication. Returns current User or raises 401 Unauthorized.
    """
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_role(*allowed_roles: str) -> Callable[[User], User]:
    """
    Create a dependency enforcing that the authenticated user possesses
    one of the specified roles. Raises 403 Forbidden if unauthorized.
    """
    def _role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: Action requires one of {allowed_roles} roles. Your role is '{user.role}'.",
            )
        return user

    return _role_checker


# Role-specific shortcut dependencies
require_admin = require_role("admin")
require_planner = require_role("planner", "admin")
require_viewer = require_role("viewer", "planner", "admin")


def verify_study_access(
    study_id: str,
    user: Optional[User],
    db: Session,
) -> StudyArea:
    """
    Verify whether the user is authorized to access the given study area.
    - Public demo study areas (like 'study-bengaluru-east', 'kerala-kochi') are visible to all.
    - Private study areas can only be accessed by their owner or an administrator.
    Raises 401 or 403 / 404 appropriately to prevent IDOR vulnerabilities.
    """
    study = db.query(StudyArea).filter(StudyArea.id == study_id).first()
    if not study:
        # Default fallback: Bengaluru East demo is always public
        if study_id in ("study-bengaluru-east", "kerala-kochi"):
            return None  # Will be served by memory cache
        raise HTTPException(status_code=404, detail=f"Study area '{study_id}' not found.")

    # Public study areas are accessible to everyone
    if study.is_public or study_id in ("study-bengaluru-east", "kerala-kochi"):
        return study

    # Private study areas require authentication
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access this private study area.",
        )

    # Admin can access all studies; otherwise user must be owner
    if user.role != "admin" and study.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You do not have permission to access this private study area.",
        )

    return study
