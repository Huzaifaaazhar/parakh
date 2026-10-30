"""Swappable LLM providers.

Groq, OpenRouter and Ollama all speak the OpenAI chat-completions
protocol, so one client covers them; switching provider is a .env change
(LLM_PROVIDER=groq|openrouter|ollama). LLM_PROVIDER=none disables LLMs
entirely and the agents use rule-based logic.
"""

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


class LLMError(Exception):
    pass


# Sensible free-tier defaults; override with LLM_MODEL / LLM_FAST_MODEL.
DEFAULT_MODELS = {
    "groq": {"chat": "llama-3.3-70b-versatile", "fast": "llama-3.1-8b-instant"},
    "openrouter": {"chat": "meta-llama/llama-3.3-70b-instruct:free", "fast": "meta-llama/llama-3.2-3b-instruct:free"},
    "ollama": {"chat": "llama3.2", "fast": "llama3.2"},
}


@dataclass
class OpenAICompatibleProvider:
    name: str
    base_url: str
    api_key: str | None
    chat_model: str
    fast_model: str

    def available(self) -> bool:
        return bool(self.api_key) or self.name == "ollama"

    def complete(self, messages: list[dict[str, str]], *, fast: bool = False, json_mode: bool = False, max_tokens: int = 700) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.name == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/huzaifaaazhar/parakh"
            headers["X-Title"] = settings.app_name
        body: dict[str, Any] = {
            "model": self.fast_model if fast else self.chat_model,
            "messages": messages,
            "temperature": 0 if json_mode else settings.llm_temperature,
            "max_tokens": max_tokens,
        }
        if json_mode and self.name != "ollama":
            body["response_format"] = {"type": "json_object"}
        try:
            resp = httpx.post(f"{self.base_url}/chat/completions", json=body, headers=headers, timeout=settings.llm_timeout)
        except httpx.HTTPError as exc:
            raise LLMError(f"{self.name}: {exc}") from exc
        if resp.status_code >= 400:
            raise LLMError(f"{self.name}: HTTP {resp.status_code} {resp.text[:200]}")
        try:
            return resp.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMError(f"{self.name}: malformed response") from exc


def build_provider(name: str, model_override: str | None = None) -> OpenAICompatibleProvider | None:
    defaults = DEFAULT_MODELS.get(name)
    if not defaults:
        return None
    base, key = {
        "groq": (settings.groq_base_url, settings.groq_api_key),
        "openrouter": (settings.openrouter_base_url, settings.openrouter_api_key),
        "ollama": (settings.ollama_base_url, None),
    }[name]
    chat = model_override or settings.llm_model or defaults["chat"]
    fast = settings.llm_fast_model or (model_override if name == "ollama" else None) or defaults["fast"]
    return OpenAICompatibleProvider(name, base.rstrip("/"), key, chat, fast)


def extract_json(text: str) -> dict[str, Any]:
    """Parse the first JSON object in a model reply (tolerates code fences / prose)."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise LLMError("No JSON object in model output")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise LLMError(f"Invalid JSON from model: {exc}") from exc
