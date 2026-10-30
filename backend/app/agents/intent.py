"""Intent + filter extraction: rules first, LLM (optional) to refine."""

import json
import re
from typing import Any

from app.core.logging import get_logger
from app.services.llm.providers import LLMError, extract_json
from app.services.llm.router import get_llm
from app.services.normalization.taxonomy import ALL_CATEGORIES, VERTICALS
from app.services.query_parser import parse_query

log = get_logger(__name__)

INTENTS = ("search", "compare", "deals", "price_drops", "sales_overview", "greeting")

_RULES: list[tuple[str, re.Pattern]] = [
    ("greeting", re.compile(r"^\s*(hi|hello|hey|salam|assalam[ -]?o[ -]?alaikum|aoa|help|what can you do)\b[\s!.?]*$", re.I)),
    (
        "sales_overview",
        re.compile(
            r"\b(which|what) (stores?|brands?|shops?) (have|has|are|is) (on )?(a )?sales?\b|\bsales? overview\b|\ball (the )?sales\b|\bwho has (a )?sale\b",
            re.I,
        ),
    ),
    ("price_drops", re.compile(r"\bprice[- ]?drops?\b|\b(dropped|reduced|slashed|went down)\b|\bprice (cut|reduction)s?\b", re.I)),
    (
        "compare",
        re.compile(
            r"\b(alternatives?|similar|compare|comparison|like this|instead of|versus|vs\.?|same (product|item)|dupe|cheaper (than|version|option)|other stores?)\b",
            re.I,
        ),
    ),
    ("deals", re.compile(r"\b(sale|sales|deals?|discount(s|ed)?|offers?|\d+\s?% off|clearance|bargain)\b", re.I)),
]


def rule_intent(message: str, has_product_context: bool) -> str:
    for intent, pattern in _RULES:
        if pattern.search(message):
            return intent
    if has_product_context and re.search(r"\b(this|it|cheaper|cheapest)\b", message, re.I):
        return "compare"
    return "search"


SYSTEM_PROMPT = """You extract shopping intent for a Pakistani price-comparison site (prices in PKR).
Return ONLY a JSON object with keys:
intent: one of {intents}
vertical: one of {verticals} or null
category: one of [{categories}] or null
gender: "men" | "women" | "kids" | null
brand: string or null
color: string or null
min_price: number or null
max_price: number or null
on_sale: boolean
sort: "relevance" | "price_asc" | "price_desc" | "discount" | "value" | "newest"
cheaper_only: boolean (user explicitly wants cheaper alternatives)
product_reference: short text naming a specific product the user wants alternatives for, or null
Rules: "3k" = 3000, "1 lac" = 100000. "best value" -> sort value. Never invent filters the user didn't imply."""


def llm_understand(message: str, history: list[dict[str, Any]]) -> dict[str, Any] | None:
    llm = get_llm()
    if not llm.enabled:
        return None
    convo = "\n".join(f"{h['role']}: {h['content'][:300]}" for h in history[-4:])
    prompt = SYSTEM_PROMPT.format(intents=list(INTENTS), verticals=list(VERTICALS), categories=", ".join(sorted(ALL_CATEGORIES)))
    user = f"Conversation so far:\n{convo or '(none)'}\n\nLatest user message: {message}"
    reply = llm.complete(
        [{"role": "system", "content": prompt}, {"role": "user", "content": user}], fast=True, json_mode=True, max_tokens=300
    )
    if not reply:
        return None
    try:
        data = extract_json(reply)
    except LLMError as exc:
        log.info("LLM intent parse failed: %s", exc)
        return None
    return sanitize_llm_filters(data)


def _num(value: Any) -> float | None:
    try:
        v = float(value)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def sanitize_llm_filters(data: dict[str, Any]) -> dict[str, Any]:
    """Never trust model output blindly: keep only values that exist in our taxonomy."""
    out: dict[str, Any] = {}
    if data.get("intent") in INTENTS:
        out["intent"] = data["intent"]
    if data.get("vertical") in VERTICALS:
        out["vertical"] = data["vertical"]
    if data.get("category") in ALL_CATEGORIES:
        out["category"] = data["category"]
        out["vertical"] = ALL_CATEGORIES[data["category"]]
    if data.get("gender") in {"men", "women", "kids"}:
        out["gender"] = data["gender"]
    for key in ("brand", "color", "product_reference"):
        if isinstance(data.get(key), str) and data[key].strip():
            out[key] = data[key].strip()[:120]
    for key in ("min_price", "max_price"):
        if (v := _num(data.get(key))) is not None:
            out[key] = v
    if data.get("sort") in {"relevance", "price_asc", "price_desc", "discount", "value", "newest"}:
        out["sort"] = data["sort"]
    for key in ("on_sale", "cheaper_only"):
        if isinstance(data.get(key), bool):
            out[key] = data[key]
    return out


def understand(
    message: str, history: list[dict[str, Any]], brands: list[str], has_product_context: bool
) -> tuple[str, dict[str, Any], bool, bool]:
    """Return (intent, filters, cheaper_only, used_llm)."""
    parsed = parse_query(message, brands)
    filters = {
        k: v
        for k, v in {
            "vertical": parsed.vertical,
            "category": parsed.category,
            "gender": parsed.gender,
            "brand": parsed.brand,
            "color": parsed.color,
            "min_price": parsed.min_price,
            "max_price": parsed.max_price,
            "on_sale": parsed.on_sale or None,
            "sort": parsed.sort if parsed.sort != "relevance" else None,
        }.items()
        if v is not None
    }
    intent = rule_intent(message, has_product_context)
    cheaper_only = bool(re.search(r"\bcheaper|cheapest|less expensive|budget\b", message, re.I))
    used_llm = False

    llm = llm_understand(message, history)
    if llm:
        used_llm = True
        intent = llm.pop("intent", intent)
        cheaper_only = llm.pop("cheaper_only", cheaper_only)
        filters.update({k: v for k, v in llm.items() if v is not None})

    # Follow-ups ("show cheaper ones", "what about for kids?") inherit the previous turn's filters.
    prev = next((h.get("meta", {}).get("filters") for h in reversed(history) if h["role"] == "assistant"), None)
    # A message naming a new category is a fresh search, not a refinement.
    if prev and not filters.get("category") and len(message.split()) <= 8 and intent in {"search", "deals"}:
        merged = {**{k: v for k, v in prev.items() if k not in {"sort"}}, **filters}
        if cheaper_only and "max_price" not in filters:
            last_prices = next(
                (h["meta"].get("prices") for h in reversed(history) if h["role"] == "assistant" and h.get("meta", {}).get("prices")), None
            )
            if last_prices:
                # "Cheaper" than what was shown: below the median of the previous results.
                merged["max_price"] = sorted(last_prices)[len(last_prices) // 2]
            merged["sort"] = "price_asc"
        filters = merged
    log.debug("understand: intent=%s filters=%s", intent, json.dumps(filters, default=str))
    return intent, filters, cheaper_only, used_llm
