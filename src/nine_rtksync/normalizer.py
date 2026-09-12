"""Auto-cura e normalização de formatos de credenciais e travas no SQLite do 9Router."""

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def parse_iso_or_str_to_ms(val: Any) -> Optional[int]:
    """Converte valores variados (string ISO, string numérica, int) em epoch milissegundos."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        v = float(val)
        if v <= 0:
            return None
        # Se for epoch em segundos (ex: 1.7e9), converte para ms
        return int(v * 1000) if v < 1e11 else int(v)

    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # Tenta conversão direta caso seja número em string
        try:
            num = float(val)
            return int(num * 1000) if num < 1e11 else int(num)
        except ValueError:
            pass

        # Converte formato ISO 8601 (ex: '2026-09-12T11:54:08.336Z')
        iso_clean = val.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(iso_clean)
            return int(dt.timestamp() * 1000)
        except Exception:
            pass

    return None


def normalize_connection_data(raw_data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any], List[str]]:
    """
    Inspeciona o dicionário de dados de uma conexão e aplica auto-cura:
    1. Corrige expiresAt gravado como ISO string pelo 9Router para número epoch em ms.
    2. Remove travas de rate limit (rateLimitedUntil) se o prazo já tiver expirado.
    3. Remove penalidades antigas de backoffLevel.

    Devolve: (modificado: bool, dados_atualizados: dict, notas: list[str])
    """
    data = dict(raw_data)
    modified = False
    notes: List[str] = []
    now_ms = int(time.time() * 1000)

    # 1. Normalização de expiresAt
    expires_at = data.get("expiresAt")
    if isinstance(expires_at, str):
        converted_ms = parse_iso_or_str_to_ms(expires_at)
        if converted_ms and converted_ms != expires_at:
            data["expiresAt"] = converted_ms
            modified = True
            notes.append(f"expiresAt convertido de string ISO ({expires_at[:24]}) para ms numérico ({converted_ms})")
    elif expires_at is not None and isinstance(expires_at, (int, float)) and expires_at < 1e11:
        # Segundos convertidos para ms
        ms = int(expires_at * 1000)
        data["expiresAt"] = ms
        modified = True
        notes.append(f"expiresAt convertido de segundos ({expires_at}) para milissegundos ({ms})")

    # Se expiresAt estiver ausente mas expiresIn existir
    if "expiresAt" not in data and "expiresIn" in data:
        try:
            exp_in = int(data["expiresIn"])
            computed_ms = now_ms + (exp_in * 1000)
            data["expiresAt"] = computed_ms
            modified = True
            notes.append(f"expiresAt derivado de expiresIn (+{exp_in}s): {computed_ms}")
        except Exception:
            pass

    # 2. Desbloqueio de rateLimitedUntil expirado
    rate_limited_until = data.get("rateLimitedUntil")
    if rate_limited_until is not None:
        lock_ms = parse_iso_or_str_to_ms(rate_limited_until)
        if lock_ms and lock_ms < now_ms:
            del data["rateLimitedUntil"]
            data["backoffLevel"] = 0
            modified = True
            notes.append("Trava de rateLimitedUntil no passado foi removida com sucesso")

    return modified, data, notes
