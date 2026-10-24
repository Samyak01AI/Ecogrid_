"""
EcoGrid AI — Authentication and Authorization Module.
"""
from app.auth.dependencies import (
    get_current_user,
    get_db,
    get_optional_user,
    require_admin,
    require_planner,
    require_role,
    require_viewer,
    verify_study_access,
)
from app.auth.router import admin_router, auth_router
from app.auth.security import (
    hash_password,
    hash_token,
    normalize_email,
    validate_password_strength,
    verify_password,
    verify_token_hash,
)
from app.auth.session_manager import (
    clear_session_cookies,
    create_user_session,
    lookup_session,
    revoke_all_sessions_for_user,
    revoke_session,
)

__all__ = [
    "auth_router",
    "admin_router",
    "get_current_user",
    "get_optional_user",
    "require_role",
    "require_admin",
    "require_planner",
    "require_viewer",
    "verify_study_access",
    "hash_password",
    "verify_password",
    "hash_token",
    "verify_token_hash",
    "validate_password_strength",
    "normalize_email",
    "create_user_session",
    "lookup_session",
    "revoke_session",
    "revoke_all_sessions_for_user",
    "clear_session_cookies",
    "get_db",
]
