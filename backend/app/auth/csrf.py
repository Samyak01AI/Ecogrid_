"""
EcoGrid AI — Cross-Site Request Forgery (CSRF) Protection.

Implements the double-submit cookie pattern with cryptographic constant-time comparison:
- A non-HttpOnly cookie (`ecogrid_csrf`) is set by the backend.
- The client reads this cookie and transmits it in the `X-CSRF-Token` HTTP header on state-changing requests.
- The server verifies that the header value matches the cookie in constant time.
- Requests with Bearer tokens (non-cookie based API calls) or safe HTTP methods are exempt.
"""
from __future__ import annotations

import hmac
import secrets
from typing import Optional
from fastapi import HTTPException, Request, Response, status

from app.config import settings

CSRF_HEADER_NAME = "X-CSRF-Token"


def generate_csrf_token() -> str:
    """Generate a cryptographically random CSRF token."""
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, request: Request, token: Optional[str] = None) -> str:
    """
    Set the CSRF cookie on the response so the frontend client can read and submit it in headers.
    """
    csrf_token = token or generate_csrf_token()
    is_secure = settings.public_https or request.url.scheme == "https"
    samesite = "none" if is_secure else "lax"

    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_token,
        httponly=False,  # Needs to be readable by JavaScript client
        secure=is_secure,
        samesite=samesite,
        path="/",
        max_age=settings.session_ttl_seconds,
    )
    return csrf_token


def validate_csrf(request: Request) -> None:
    """
    Validate CSRF token for state-changing HTTP requests that rely on cookies.
    Raises HTTPException(403) if validation fails.
    """
    # Safe HTTP methods do not change state
    if request.method in ("GET", "HEAD", "OPTIONS", "TRACE"):
        return

    # Public authentication endpoints do not require CSRF
    if request.url.path in (
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
    ):
        return

    # If the client authenticates using a Bearer token in Authorization header,
    # CSRF protection is not needed because browsers do not automatically send Bearer tokens.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return

    # Check if a session cookie is present. If no session cookie is present, CSRF is exempt.
    session_cookie = request.cookies.get(settings.session_cookie_name)
    if not session_cookie:
        return

    csrf_cookie = request.cookies.get(settings.csrf_cookie_name)
    csrf_header = request.headers.get(CSRF_HEADER_NAME)

    if not csrf_cookie or not csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF verification failed: Missing CSRF token in header or cookie.",
        )

    if not hmac.compare_digest(csrf_cookie.strip(), csrf_header.strip()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF verification failed: Token mismatch.",
        )
