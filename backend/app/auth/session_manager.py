"""
EcoGrid AI — Server-Side Session Manager.

Manages cryptographically secure sessions:
- Server stores only SHA-256 hash of the random session token in the database.
- Raw token is sent exclusively in an HttpOnly, Secure, SameSite cookie.
- Validates expiration and revocation status on every request.
- Rotates session tokens after authentication to prevent session fixation.
- Revokes sessions on logout, password changes, or account security events.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import Request, Response
from sqlalchemy.orm import Session

from app.auth.csrf import set_csrf_cookie
from app.auth.security import generate_secure_token, hash_token
from app.config import settings
from app.models.database import SessionRecord, User


def get_client_ip(request: Request) -> Optional[str]:
    """Extract client IP, honoring X-Forwarded-For if behind a proxy."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # First IP in the list is the client
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def utcnow() -> datetime:
    """Return timezone-naive UTC timestamp for database compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_user_session(
    db: Session,
    user: User,
    request: Request,
    response: Response,
) -> Tuple[SessionRecord, str]:
    """
    Create a new persistent session, store its cryptographic hash in the database,
    and set the secure HttpOnly cookie on the response.
    """
    raw_token = generate_secure_token(32)
    token_hash = hash_token(raw_token)
    expires_at = utcnow() + timedelta(seconds=settings.session_ttl_seconds)

    session_record = SessionRecord(
        id=f"sess_{uuid.uuid4().hex}",
        user_id=user.id,
        token_hash=token_hash,
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:500],
        expires_at=expires_at,
        created_at=utcnow(),
    )
    db.add(session_record)
    db.commit()
    db.refresh(session_record)

    # Set secure session cookie
    is_secure = settings.public_https or request.url.scheme == "https"
    samesite = "none" if is_secure else "lax"

    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        httponly=True,  # Protect against XSS
        secure=is_secure,
        samesite=samesite,
        path="/",
        max_age=settings.session_ttl_seconds,
    )

    # Also set or refresh the CSRF cookie
    set_csrf_cookie(response, request)

    return session_record, raw_token


def lookup_session(db: Session, raw_token: str) -> Optional[SessionRecord]:
    """
    Look up an active session by its raw token.
    Validates expiration and ensures session has not been revoked.
    """
    token_hash = hash_token(raw_token)
    session_record = (
        db.query(SessionRecord)
        .filter(SessionRecord.token_hash == token_hash)
        .first()
    )

    if not session_record:
        return None

    # Check revocation
    if session_record.revoked_at is not None:
        return None

    # Check expiration
    if session_record.expires_at < utcnow():
        return None

    return session_record


def revoke_session(db: Session, session_record: SessionRecord) -> None:
    """Invalidate a specific server-side session."""
    session_record.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions_for_user(
    db: Session,
    user_id: str,
    keep_session_id: Optional[str] = None,
) -> int:
    """
    Revoke all active sessions for a user (e.g. after password reset or password change).
    Optionally keep one active session ID.
    """
    query = (
        db.query(SessionRecord)
        .filter(
            SessionRecord.user_id == user_id,
            SessionRecord.revoked_at.is_(None),
        )
    )
    if keep_session_id:
        query = query.filter(SessionRecord.id != keep_session_id)

    count = 0
    now = utcnow()
    for s in query.all():
        s.revoked_at = now
        count += 1

    db.commit()
    return count


def clear_session_cookies(response: Response, request: Request) -> None:
    """Delete session and CSRF cookies using matching cookie attributes."""
    is_secure = settings.public_https or request.url.scheme == "https"
    samesite = "none" if is_secure else "lax"

    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=is_secure,
        samesite=samesite,
    )
    response.delete_cookie(
        key=settings.csrf_cookie_name,
        path="/",
        secure=is_secure,
        samesite=samesite,
    )
