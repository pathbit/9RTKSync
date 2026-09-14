"""Self-healing and format normalization for credentials and rate-limit locks in the gateway store."""

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def parse_iso_or_str_to_ms(val: Any) -> Optional[int]:
    """Convert various values (ISO string, numeric string, int, float) to epoch milliseconds."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        v = float(val)
        if v <= 0:
            return None
        # If epoch in seconds (e.g. 1.7e9), convert to ms
        return int(v * 1000) if v < 1e11 else int(v)

    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # Try direct numeric conversion
        try:
            num = float(val)
            return int(num * 1000) if num < 1e11 else int(num)
        except ValueError:
            pass

        # Convert ISO 8601 format (e.g. '2026-09-12T11:54:08.336Z')
        iso_clean = val.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(iso_clean)
            return int(dt.timestamp() * 1000)
        except Exception:
            pass

    return None


def normalize_connection_data(raw_data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any], List[str]]:
    """
    Inspect connection data dictionary and apply self-healing:
    1. Fix expiresAt stored as an ISO string by the gateway to numeric epoch in ms.
    2. Remove rate-limit locks (rateLimitedUntil) if cooldown has elapsed.
    3. Clear legacy backoffLevel penalties.

    Returns: (modified: bool, updated_data: dict, notes: list[str])
    """
    data = dict(raw_data)
    modified = False
    notes: List[str] = []
    now_ms = int(time.time() * 1000)

    # 1. Normalization of expiresAt
    expires_at = data.get("expiresAt")
    if isinstance(expires_at, str):
        converted_ms = parse_iso_or_str_to_ms(expires_at)
        if converted_ms and converted_ms != expires_at:
            data["expiresAt"] = converted_ms
            modified = True
            notes.append(f"expiresAt converted from ISO string ({expires_at[:24]}) to numeric ms ({converted_ms})")
    elif expires_at is not None and isinstance(expires_at, (int, float)) and expires_at < 1e11:
        # Seconds converted to ms
        ms = int(expires_at * 1000)
        data["expiresAt"] = ms
        modified = True
        notes.append(f"expiresAt converted from seconds ({expires_at}) to milliseconds ({ms})")

    # If expiresAt is missing but expiresIn exists
    if "expiresAt" not in data and "expiresIn" in data:
        try:
            exp_in = int(data["expiresIn"])
            computed_ms = now_ms + (exp_in * 1000)
            data["expiresAt"] = computed_ms
            modified = True
            notes.append(f"expiresAt derived from expiresIn (+{exp_in}s): {computed_ms}")
        except Exception:
            pass

    # 2. Unlock expired rateLimitedUntil
    rate_limited_until = data.get("rateLimitedUntil")
    if rate_limited_until is not None:
        lock_ms = parse_iso_or_str_to_ms(rate_limited_until)
        if lock_ms and lock_ms < now_ms:
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            notes.append("Expired rateLimitedUntil lock successfully cleared")

    # 3. Clean up expired model locks (modelLock_*)
    for k in list(data.keys()):
        if k.startswith("modelLock_"):
            lock_val = data[k]
            lock_ms = parse_iso_or_str_to_ms(lock_val)
            if lock_ms and lock_ms < now_ms:
                del data[k]
                modified = True
                notes.append(f"Temporary model lock {k} expired and removed")

    return modified, data, notes
