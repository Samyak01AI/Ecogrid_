"""
EcoGrid AI — Cryptographic Security and Password Handling.

Implements:
- Argon2id password hashing via argon2-cffi.
- Password complexity validation (12+ characters, upper, lower, digit, symbol).
- Cryptographically secure token generation (secrets.token_urlsafe).
- Constant-time token comparisons (hmac.compare_digest).
- SHA-256 cryptographic token hashing (for session tokens & reset tokens stored in DB).
- Email normalization.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Tuple

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

# Argon2id password hasher with recommended secure parameters
_ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

PASSWORD_MIN_LENGTH = 12


def hash_password(password: str) -> str:
    """Hash password using Argon2id."""
    return _ph.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against Argon2id hash with timing-safe error handling."""
    try:
        return _ph.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:
        return False


def validate_password_strength(password: str) -> Tuple[bool, str]:
    """
    Validate that password satisfies security requirements:
    - At least 12 characters
    - At least one uppercase character
    - At least one lowercase character
    - At least one digit
    - At least one symbol
    """
    if len(password) < PASSWORD_MIN_LENGTH:
        return False, f"Password must be at least {PASSWORD_MIN_LENGTH} characters long."
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter."
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter."
    if not re.search(r"[0-9]", password):
        return False, "Password must contain at least one number."
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>/?`~]', password):
        return False, "Password must contain at least one special character."
    return True, ""


def normalize_email(email: str) -> str:
    """Normalize email to trimmed lowercase."""
    return email.strip().lower()


def generate_secure_token(nbytes: int = 32) -> str:
    """Generate cryptographically random token."""
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Hash token using SHA-256 for persistent database storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token_hash(raw_token: str, stored_hash: str) -> bool:
    """Compare raw token with stored SHA-256 hash in constant time."""
    computed = hash_token(raw_token)
    return hmac.compare_digest(computed, stored_hash)
