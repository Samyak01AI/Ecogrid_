"""
EcoGrid AI — Configuration via environment variables.
Uses pydantic-settings for typed, validated configuration.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    # Database
    database_url: str = "postgresql://ecogrid:ecogrid@localhost:5433/ecogrid"

    # Server
    api_port: int = 3001
    api_host: str = "0.0.0.0"

    # CORS
    web_origin: str = "http://localhost:3000"

    # ML model service (optional)
    model_url: Optional[str] = None

    # Grok xAI Multi-API Key Configuration (supports at least 5 keys with auto-switching)
    grok_api_key_1: Optional[str] = None
    grok_api_key_2: Optional[str] = None
    grok_api_key_3: Optional[str] = None
    grok_api_key_4: Optional[str] = None
    grok_api_key_5: Optional[str] = None
    grok_api_keys: Optional[str] = None
    xai_api_key: Optional[str] = None
    grok_base_url: str = "https://api.x.ai/v1"
    grok_model: str = "grok-2-latest"

    # Demo defaults
    default_budget: float = 500000.0  # INR
    default_study_id: str = "study-bengaluru-east"

    # Authentication & Session Security
    environment: str = "development"
    secret_key: str = "ecogrid-default-secret-key-replace-in-production-min-32-chars"
    session_cookie_name: str = "ecogrid_session"
    csrf_cookie_name: str = "ecogrid_csrf"
    session_ttl_seconds: int = 604800  # 7 days
    public_https: bool = False
    rate_limit_login_attempts: int = 5
    rate_limit_window_seconds: int = 300  # 5 minutes

    # Seed Admin Account (optional bootstrap)
    seed_admin_email: Optional[str] = "planner@example.test"
    seed_admin_password: Optional[str] = None
    seed_admin_name: str = "EcoGrid Lead Planner"

    # SMTP Configuration (optional for password reset emails)
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: str = "noreply@ecogrid.ai"

    class Config:
        env_file = [".env", "../.env", "backend/.env"]
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
