"""
EcoGrid AI — Grok / Groq Multi-API Key Failover Engine
(Stage 7: Autonomous Planning Assistant & Multi-Key Pool)

Features:
- Multi-API Key Pool (supports 5+ keys with automatic switching & failover)
- Intelligent detection of Groq (`gsk_...`) and xAI Grok (`xai-...`) providers
- Automatic rate-limit (HTTP 429), quota exhaustion, and timeout failover
- 60-second backoff cooldown for throttled keys with seamless hot-standby rotation
- Live telemetry tracking active key index, requests served, and failover events
- Deterministic heuristic domain fallback if all keys are temporarily offline
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class GrokKeyStatus:
    def __init__(self, key: str, index: int):
        self.key: str = key.strip()
        self.index: int = index  # 1-indexed for human readability
        self.status: str = "HEALTHY"  # HEALTHY | COOLDOWN | ERROR
        self.cooldown_until: float = 0.0
        self.request_count: int = 0
        self.failover_count: int = 0
        self.last_error: Optional[str] = None
        self.last_used_at: float = 0.0

    @property
    def is_available(self) -> bool:
        if self.status == "COOLDOWN" and time.time() > self.cooldown_until:
            self.status = "HEALTHY"
            self.last_error = None
        return self.status == "HEALTHY"

    @property
    def masked_key(self) -> str:
        if len(self.key) <= 10:
            return "***"
        return f"{self.key[:6]}...{self.key[-4:]}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "masked_key": self.masked_key,
            "status": "COOLDOWN" if time.time() < self.cooldown_until else "HEALTHY",
            "cooldown_remaining_sec": max(0, int(self.cooldown_until - time.time())),
            "request_count": self.request_count,
            "failover_count": self.failover_count,
            "last_error": self.last_error,
        }


class GrokMultiKeyPool:
    """Manages a pool of at least 5 Grok/Groq API keys with automatic failover."""

    def __init__(self):
        self.keys: list[GrokKeyStatus] = []
        self.current_index: int = 0
        self.total_failovers: int = 0
        self._init_pool()

    def _init_pool(self):
        """Loads all available keys from settings / environment."""
        raw_keys: list[str] = []

        # 1. Check individual key variables grok_api_key_1 through 5
        for idx in range(1, 10):
            val = getattr(settings, f"grok_api_key_{idx}", None)
            if val and val.strip():
                raw_keys.append(val.strip())

        # 2. Check comma-separated keys
        if settings.grok_api_keys:
            for k in settings.grok_api_keys.split(","):
                k_clean = k.strip()
                if k_clean and k_clean not in raw_keys:
                    raw_keys.append(k_clean)

        # 3. Check xai_api_key
        if settings.xai_api_key and settings.xai_api_key.strip() not in raw_keys:
            raw_keys.append(settings.xai_api_key.strip())

        # Ensure unique while preserving order
        seen = set()
        unique_keys = []
        for k in raw_keys:
            if k not in seen:
                seen.add(k)
                unique_keys.append(k)

        self.keys = [GrokKeyStatus(key=k, index=i + 1) for i, k in enumerate(unique_keys)]
        logger.info("[GrokPool] Initialized key pool with %d API keys.", len(self.keys))

    def get_provider_and_url(self, key: str) -> tuple[str, str, str]:
        """
        Determines the endpoint and default model.
        Detects Groq keys (starting with gsk_) vs xAI keys.
        """
        base_url = settings.grok_base_url
        model = settings.grok_model

        if key.startswith("gsk_"):
            provider = "Groq"
            if not base_url or "api.x.ai" in base_url:
                base_url = "https://api.groq.com/openai/v1"
            # Normalize model name for Groq if needed
            if model in ["Qwen3.8-27B", "grok-2-latest", "grok-beta"]:
                model = "qwen/qwen3.8-27b"
        else:
            provider = "xAI Grok"
            if not base_url or "api.groq.com" in base_url:
                base_url = "https://api.x.ai/v1"
            if model.startswith("qwen/"):
                model = "grok-2-latest"

        return provider, base_url, model

    def get_next_available_key(self) -> Optional[GrokKeyStatus]:
        """Finds next available healthy key in pool."""
        if not self.keys:
            return None

        n = len(self.keys)
        # Try finding a healthy key starting from current_index
        for step in range(n):
            idx = (self.current_index + step) % n
            key_obj = self.keys[idx]
            if key_obj.is_available:
                self.current_index = idx
                return key_obj

        # If all keys are in cooldown, pick the one with earliest cooldown expiry
        oldest_cooldown_key = min(self.keys, key=lambda k: k.cooldown_until)
        logger.warning(
            "[GrokPool] All keys in cooldown. Forcing reset on Key #%d.",
            oldest_cooldown_key.index,
        )
        oldest_cooldown_key.status = "HEALTHY"
        oldest_cooldown_key.cooldown_until = 0.0
        self.current_index = oldest_cooldown_key.index - 1
        return oldest_cooldown_key

    def mark_key_cooldown(self, key_obj: GrokKeyStatus, error_msg: str, cooldown_seconds: int = 60):
        """Marks key as cooling down due to rate limit or API failure."""
        key_obj.status = "COOLDOWN"
        key_obj.cooldown_until = time.time() + cooldown_seconds
        key_obj.failover_count += 1
        key_obj.last_error = error_msg
        self.total_failovers += 1
        # Advance current index to hot standby key
        self.current_index = (self.current_index + 1) % len(self.keys)
        logger.warning(
            "[GrokPool] Key #%d put in cooldown (%ds) due to: %s. Switched active key to #%d.",
            key_obj.index,
            cooldown_seconds,
            error_msg,
            self.keys[self.current_index].index,
        )

    async def generate_completion(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        """
        Executes a chat completion with automatic multi-key failover and switching.
        Cycles through keys on 429 (Rate Limit), 401/403 (Invalid Key), or 5xx errors.
        """
        if not self.keys:
            self._init_pool()

        if not self.keys:
            logger.warning("[GrokPool] No API keys configured. Using heuristic generator.")
            return {
                "content": "",
                "provider": "Heuristic Fallback",
                "model": "rule-based",
                "key_index": 0,
                "total_keys": 0,
                "failover_count": 0,
                "success": False,
            }

        max_attempts = len(self.keys)
        attempts = 0
        failover_switches = 0
        last_exception = None

        while attempts < max_attempts:
            key_obj = self.get_next_available_key()
            if not key_obj:
                break

            provider, base_url, model = self.get_provider_and_url(key_obj.key)
            endpoint = f"{base_url.rstrip('/')}/chat/completions"
            headers = {
                "Authorization": f"Bearer {key_obj.key}",
                "Content-Type": "application/json",
                "User-Agent": "EcoGridAI-Assistant/2.0",
            }
            candidate_models = [model]
            if provider == "Groq":
                for alt_m in ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]:
                    if alt_m not in candidate_models:
                        candidate_models.append(alt_m)

            model_succeeded = False
            for try_model in candidate_models:
                payload = {
                    "model": try_model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }

                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        resp = await client.post(endpoint, json=payload, headers=headers)

                        if resp.status_code == 200:
                            data = resp.json()
                            content = data["choices"][0]["message"]["content"]
                            key_obj.request_count += 1
                            key_obj.last_used_at = time.time()
                            return {
                                "content": content,
                                "provider": provider,
                                "model": try_model,
                                "key_index": key_obj.index,
                                "total_keys": len(self.keys),
                                "failover_count": failover_switches,
                                "masked_key": key_obj.masked_key,
                                "success": True,
                            }

                        elif resp.status_code in [429]:
                            # Rate limited on this model; if more models remain, try next model; otherwise rotate key
                            err_text = resp.text[:120]
                            logger.warning(
                                "[GrokPool] Key #%d hit 429 on model '%s': %s",
                                key_obj.index,
                                try_model,
                                err_text,
                            )
                            continue

                        elif resp.status_code in [401, 403]:
                            err_text = resp.text[:120]
                            self.mark_key_cooldown(
                                key_obj,
                                f"Auth Failed ({resp.status_code}): {err_text}",
                                cooldown_seconds=300,
                            )
                            failover_switches += 1
                            break

                        else:
                            err_text = resp.text[:120]
                            logger.error(
                                "[GrokPool] Key #%d model '%s' error HTTP %d: %s",
                                key_obj.index,
                                try_model,
                                resp.status_code,
                                err_text,
                            )
                            continue

                except httpx.RequestError as exc:
                    last_exception = exc
                    logger.warning("[GrokPool] Network error on Key #%d: %s", key_obj.index, exc)
                    break

            # If all models on this key returned 429 or error, cool down this key and rotate
            self.mark_key_cooldown(
                key_obj,
                "Rate limit or models exhausted",
                cooldown_seconds=45,
            )
            failover_switches += 1
            attempts += 1


        logger.error("[GrokPool] All %d API keys exhausted or rate-limited. Last error: %s", len(self.keys), last_exception)
        return {
            "content": "",
            "provider": "Heuristic Fallback",
            "model": "rule-based",
            "key_index": self.keys[0].index if self.keys else 0,
            "total_keys": len(self.keys),
            "failover_count": failover_switches,
            "success": False,
            "error": str(last_exception) if last_exception else "All API keys in cooldown",
        }

    def get_pool_status(self) -> dict[str, Any]:
        """Returns health status, active index, and statistics for all keys."""
        return {
            "total_keys": len(self.keys),
            "active_key_index": self.keys[self.current_index].index if self.keys else None,
            "healthy_count": sum(1 for k in self.keys if k.is_available),
            "cooldown_count": sum(1 for k in self.keys if not k.is_available),
            "total_failover_switches": self.total_failovers,
            "default_model": settings.grok_model,
            "base_url": settings.grok_base_url,
            "keys": [k.to_dict() for k in self.keys],
        }


# Global singleton instance
grok_pool = GrokMultiKeyPool()
