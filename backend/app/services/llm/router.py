"""Model routing with graceful fallback.

- Tries the configured provider, then LLM_FALLBACK_PROVIDERS in order.
- `fast=True` routes cheap tasks (intent extraction) to a smaller model.
- With LLM_PROVIDER=ollama (or auto) and LLMFIT_URL set, asks llmfit
  (https://github.com/Huzaifaaazhar/llmfit, `llmfit serve`) which local model
  best fits this machine's hardware and uses it.
- A provider that fails is put on a short cooldown so requests don't keep
  paying its timeout.
- If everything fails (or LLM_PROVIDER=none) callers get None and use rules.
"""

import time
from functools import lru_cache

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.llm.providers import LLMError, OpenAICompatibleProvider, build_provider

log = get_logger(__name__)

COOLDOWN_SECONDS = 60


@lru_cache
def llmfit_recommended_model(use_case: str = "chat") -> str | None:
    if not settings.llmfit_url:
        return None
    try:
        resp = httpx.get(
            f"{settings.llmfit_url.rstrip('/')}/api/v1/models/top",
            params={"limit": 1, "min_fit": "good", "use_case": use_case},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        rows = data.get("models") if isinstance(data, dict) else data
        if rows:
            name = rows[0].get("name") or rows[0].get("model")
            log.info("llmfit recommends local model %s", name)
            return name
    except Exception as exc:  # noqa: BLE001
        log.warning("llmfit lookup failed: %s", exc)
    return None


class LLMRouter:
    def __init__(self) -> None:
        self._down_until: dict[str, float] = {}
        self.providers = self._build_chain()

    def _build_chain(self) -> list[OpenAICompatibleProvider]:
        primary = settings.llm_provider.lower()
        if primary == "none":
            return []
        names = ["groq", "openrouter", "ollama"] if primary == "auto" else [primary]
        names += [n.strip().lower() for n in settings.llm_fallback_providers.split(",") if n.strip()]
        chain = []
        for name in dict.fromkeys(names):
            override = llmfit_recommended_model() if name == "ollama" else None
            provider = build_provider(name, override)
            if provider and provider.available():
                chain.append(provider)
            elif provider:
                log.info("LLM provider %s skipped (no API key)", name)
        return chain

    @property
    def enabled(self) -> bool:
        return bool(self.providers)

    def complete(self, messages: list[dict[str, str]], *, fast: bool = False, json_mode: bool = False, max_tokens: int = 700) -> str | None:
        now = time.time()
        for provider in self.providers:
            if self._down_until.get(provider.name, 0) > now:
                continue
            try:
                return provider.complete(messages, fast=fast, json_mode=json_mode, max_tokens=max_tokens)
            except LLMError as exc:
                log.warning("LLM provider failed, trying next: %s", exc)
                self._down_until[provider.name] = now + COOLDOWN_SECONDS
        return None


@lru_cache
def get_llm() -> LLMRouter:
    return LLMRouter()
