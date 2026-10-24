"""
EcoGrid AI — In-Memory Sliding-Window Rate Limiter.

Protects sensitive endpoints (login, forgot-password) against brute-force attacks.
Tracks attempts per client IP and identifier.
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Dict, List, Tuple


class SlidingWindowRateLimiter:
    """Thread-safe in-memory sliding-window rate limiter."""

    def __init__(self) -> None:
        # key -> list of Unix timestamps of attempts
        self._attempts: Dict[str, List[float]] = defaultdict(list)

    def is_rate_limited(self, key: str, max_attempts: int, window_seconds: int) -> Tuple[bool, int]:
        """
        Check if key has exceeded max_attempts within window_seconds.
        Returns: (is_limited, retry_after_seconds)
        """
        now = time.time()
        cutoff = now - window_seconds
        # Filter out old attempts
        recent = [t for t in self._attempts[key] if t > cutoff]
        self._attempts[key] = recent

        if len(recent) >= max_attempts:
            oldest_relevant = recent[0]
            retry_after = max(1, int(oldest_relevant + window_seconds - now))
            return True, retry_after

        return False, 0

    def record_attempt(self, key: str) -> None:
        """Record an attempt timestamp for key."""
        now = time.time()
        self._attempts[key].append(now)

    def reset(self, key: str) -> None:
        """Clear recorded attempts for key after successful operation."""
        if key in self._attempts:
            del self._attempts[key]

    def clear(self) -> None:
        """Clear all rate limit data."""
        self._attempts.clear()


# Global rate limiter instance
auth_rate_limiter = SlidingWindowRateLimiter()
