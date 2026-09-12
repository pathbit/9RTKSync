"""Manager for resilience and fallback combos in 9Router SQLite database."""

import json
from typing import List, Tuple

from .database import upsert_combos


def get_default_combos(module: str = "all") -> List[Tuple[str, str, str, str]]:
    """
    Return list of standard resilience combos.
    Format: (id, name, kind, models_json)
    """
    combos = [
        (
            "claudegravity-fallback",
            "claudegravity-fallback",
            "llm",
            json.dumps([
                "ag/gemini-3.8-flash-high",
                "ag/gemini-3.7-flash-high",
                "ag/gemini-3.6-flash-high",
                "ag/claude-sonnet-4-6",
                "ag/gpt-oss-120b-medium",
            ]),
        ),
        (
            "claudegravity-thinking",
            "claudegravity-thinking",
            "llm",
            json.dumps([
                "ag/claude-opus-4-6-thinking",
                "ag/claude-sonnet-4-6",
                "ag/gemini-3.8-flash-high",
                "ag/gemini-3.7-flash-high",
            ]),
        ),
    ]

    if module in ("all", "0003"):
        combos.extend([
            (
                "arsenal-supremo",
                "arsenal-supremo",
                "llm",
                json.dumps([
                    "ag/gemini-3.8-flash-high",
                    "ag/gemini-3.7-flash-high",
                    "ag/gemini-3.6-flash-high",
                    "openrouter/cohere/north-mini-code:free",
                    "groq/openai/gpt-oss-120b",
                    "mistral/codestral-latest",
                    "openai-compatible-chat-ollama-local/qwen2.5-coder:latest",
                ]),
            ),
            (
                "arsenal-rapido",
                "arsenal-rapido",
                "llm",
                json.dumps([
                    "groq/openai/gpt-oss-120b",
                    "mistral/codestral-latest",
                    "ag/gemini-3.7-flash-high",
                    "ag/gemini-3.6-flash-high",
                ]),
            ),
            (
                "arsenal-offline",
                "arsenal-offline",
                "llm",
                json.dumps([
                    "openai-compatible-chat-ollama-local/qwen2.5-coder:latest",
                ]),
            ),
        ])

    return combos


def sync_combos(db_path: str, module: str = "all") -> int:
    """Insert or update standard combos in SQLite database."""
    combos = get_default_combos(module)
    return upsert_combos(db_path, combos)
