"""
EcoGrid AI — Pydantic Schemas for Authentication and Role Management.
"""
from __future__ import annotations

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120, description="User's full name")
    email: str = Field(..., min_length=5, max_length=254, description="Email address")
    password: str = Field(..., min_length=12, max_length=128, description="Password (min 12 chars)")
    confirm_password: str = Field(..., min_length=12, max_length=128, description="Password confirmation")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean):
            raise ValueError("Please provide a valid email address.")
        return clean

    @field_validator("confirm_password")
    @classmethod
    def validate_passwords_match(cls, v: str, info) -> str:
        password = info.data.get("password")
        if password and v != password:
            raise ValueError("Passwords do not match.")
        return v


class LoginRequest(BaseModel):
    email: str = Field(..., description="Email address")
    password: str = Field(..., description="Password")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return v.strip().lower()


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., description="Registered email address")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return v.strip().lower()


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10, description="Single-use password reset token")
    new_password: str = Field(..., min_length=12, max_length=128, description="New password")
    confirm_password: str = Field(..., min_length=12, max_length=128, description="Password confirmation")

    @field_validator("confirm_password")
    @classmethod
    def validate_passwords_match(cls, v: str, info) -> str:
        password = info.data.get("new_password")
        if password and v != password:
            raise ValueError("Passwords do not match.")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., description="Existing password")
    new_password: str = Field(..., min_length=12, max_length=128, description="New password")
    confirm_password: str = Field(..., min_length=12, max_length=128, description="Password confirmation")

    @field_validator("confirm_password")
    @classmethod
    def validate_passwords_match(cls, v: str, info) -> str:
        password = info.data.get("new_password")
        if password and v != password:
            raise ValueError("Passwords do not match.")
        return v


class UserResponse(BaseModel):
    id: str
    fullName: str
    email: str
    role: str
    isActive: bool
    createdAt: str


class RoleUpdateRequest(BaseModel):
    role: str = Field(..., description="Assigned role: 'viewer', 'planner', or 'admin'")

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        role = v.strip().lower()
        if role not in ("viewer", "planner", "admin"):
            raise ValueError("Role must be one of: 'viewer', 'planner', 'admin'.")
        return role


class StatusUpdateRequest(BaseModel):
    is_active: bool = Field(..., description="Active status flag")
