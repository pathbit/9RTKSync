"""Google credential handler (Antigravity and Gemini CLI)."""

import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord
from ..normalizer import parse_iso_or_str_to_ms
from .base import BaseProvider


class GoogleProvider(BaseProvider):
    """OAuth manager for Google Antigravity and Gemini CLI."""

    OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

    def __init__(self, credential_paths: Optional[List[str]] = None, discovery: Optional[Any] = None):
        self.credential_paths = credential_paths or []
        self.discovery = discovery

    def can_handle(self, conn: ConnectionRecord) -> bool:
        return conn.provider in ("antigravity", "gemini-cli")

    def find_local_credential_file(self) -> Optional[str]:
        """Locate host-mounted token file."""
        if self.discovery:
            disc = self.discovery.discover_google()
            if disc and disc.get("source_path"):
                return disc["source_path"]
        for p in self.credential_paths:
            if p and os.path.exists(p) and os.path.isfile(p):
                return p
        return None

    def read_local_credential(self) -> Optional[Dict[str, Any]]:
        """Read local token file if present."""
        if self.discovery:
            disc = self.discovery.discover_google()
            if disc and disc.get("accessToken"):
                return {
                    "access_token": disc.get("accessToken"),
                    "refresh_token": disc.get("refreshToken"),
                    "client_id": disc.get("clientId"),
                    "client_secret": disc.get("clientSecret"),
                    "expiry": disc.get("expiry"),
                }
        path = self.find_local_credential_file()
        if not path:
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            tok = data.get("access_token") or data.get("accessToken") or data.get("token")
            if tok and "access_token" not in data:
                data["access_token"] = tok
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def discover_client_secrets(self, conn: ConnectionRecord) -> Tuple[str, str]:
        """Extract clientId and clientSecret from payload or environment variables."""
        client_id = conn.data.get("clientId") or os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = conn.data.get("clientSecret") or os.environ.get("GOOGLE_CLIENT_SECRET", "")
        if client_id and client_secret:
            return client_id, client_secret

        # Try to discover from host local file
        local = self.read_local_credential()
        if local:
            client_id = local.get("client_id") or local.get("clientId") or client_id
            client_secret = local.get("client_secret") or local.get("clientSecret") or client_secret

        # Fallback: discover in 9Router provider files if running in the same container/volume
        data_dir = os.environ.get("DATA_DIR", "/app/data")
        candidate_files = [
            os.path.join(data_dir, "shared.js"),
            "/app/data/shared.js",
            "/app/open-sse/providers/shared.js",
            "/app/open-sse/providers/registry/antigravity.js",
        ]
        for fpath in candidate_files:
            if os.path.exists(fpath):
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    import re
                    m_id = re.search(r'clientId:\s*["\']([^"\']+)["\']', content)
                    m_sec = re.search(r'clientSecret:\s*["\']([^"\']+)["\']', content)
                    if m_id and not client_id:
                        client_id = m_id.group(1)
                    if m_sec and not client_secret:
                        client_secret = m_sec.group(1)
                    if client_id and client_secret:
                        break
                except Exception:
                    pass

        return client_id or "", client_secret or ""

    def refresh_oauth_token(
        self, refresh_token: str, client_id: str, client_secret: str
    ) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """Send standard HTTPS request to oauth2.googleapis.com."""
        if not client_id or not client_secret:
            return False, None, "client_id or client_secret not configured in environment nor found in shared.js"
        payload = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        }).encode("utf-8")

        req = urllib.request.Request(
            self.OAUTH_TOKEN_URL,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "9rtksync/1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=20.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return True, data, "OK"
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:300]
            return False, None, f"HTTP {e.code}: {err_body}"
        except Exception as e:
            return False, None, str(e)

    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        messages: List[str] = []
        data = dict(conn.data)
        now_ms = int(time.time() * 1000)

        # 1. If there is a local credential on the host
        local = self.read_local_credential()
        needs_refresh = False

        if local:
            local_ref = local.get("refresh_token") or local.get("refreshToken")
            if local_ref and data.get("refreshToken") != local_ref:
                data["refreshToken"] = local_ref
                needs_refresh = True
                messages.append("RefreshToken updated from host")

            local_tok = local.get("access_token") or local.get("accessToken")
            local_exp_ms = parse_iso_or_str_to_ms(local.get("expiry"))
            local_is_valid = (local_exp_ms is None or local_exp_ms > (now_ms + margin_seconds))

            if local_tok and local_tok != data.get("accessToken") and local_is_valid and not data.get("rateLimitedUntil") and not data.get("errorCode"):
                data["accessToken"] = local_tok
                data["expiresAt"] = local_exp_ms or (now_ms + (3599 * 1000))
                data["testStatus"] = "active"
                messages.append("Token updated from host local credential file")
                return True, data, messages

        # 2. Evaluate need for renewal
        rem = conn.remaining_seconds

        if data.get("errorCode") in (401, 403) or data.get("lastError") or data.get("rateLimitedUntil") or any(k.startswith("modelLock_") for k in data):
            needs_refresh = True
            messages.append("Connection has pending error or model lock on gateway; triggering OAuth renewal")

        if rem is None:
            needs_refresh = True
            messages.append("expiresAt missing or corrupted")
        elif rem <= margin_seconds:
            needs_refresh = True
            messages.append(f"Validity near expiration ({rem}s remaining <= {margin_seconds}s)")

        if not needs_refresh:
            messages.append(f"Token valid for another {rem // 60} min")
            return False, None, messages

        # 3. Perform OAuth renewal
        refresh_token = data.get("refreshToken")
        if not refresh_token and local:
            refresh_token = local.get("refresh_token") or local.get("refreshToken")

        if not refresh_token:
            messages.append("refreshToken not available for automated renewal")
            return False, None, messages

        client_id, client_secret = self.discover_client_secrets(conn)
        if not client_id or not client_secret:
            messages.append("clientId or clientSecret not found for this provider")
            return False, None, messages

        ok, resp, err = self.refresh_oauth_token(refresh_token, client_id, client_secret)
        if not ok:
            messages.append(f"OAuth renewal failed: {err}")
            return False, None, messages

        expires_in = int(resp.get("expires_in", 3599))
        data["accessToken"] = resp["access_token"]
        if resp.get("refresh_token"):
            data["refreshToken"] = resp["refresh_token"]
        data["expiresAt"] = now_ms + (expires_in * 1000)
        data["testStatus"] = "active"
        data["backoffLevel"] = 0

        # Clean residual locks and errors
        for k in list(data.keys()):
            if k.startswith("modelLock_"):
                del data[k]
        if "rateLimitedUntil" in data:
            del data["rateLimitedUntil"]
        if "errorCode" in data:
            del data["errorCode"]
        if "lastError" in data:
            del data["lastError"]
        if "lastErrorAt" in data:
            del data["lastErrorAt"]

        messages.append(f"Access token successfully renewed via Google OAuth ({expires_in}s)")
        return True, data, messages

