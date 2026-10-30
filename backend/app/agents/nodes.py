"""LangGraph nodes: the four agents plus memory load/save.

The DB session is passed through the run config (`configurable.db`) rather
than the state, so state stays serialisable.
"""

import json
import re
from typing import Any

from langchain_core.runnables import RunnableConfig
from sqlalchemy.orm import Session

from app.agents import intent as intent_mod
from app.agents.state import AgentState
from app.core.errors import AppError
from app.core.logging import get_logger
from app.services import comparison_service, deal_service, product_service
from app.services.llm.router import get_llm
from app.services.memory.memory import get_memory

log = get_logger(__name__)

MAX_PRODUCTS = 8


def _db(config: RunnableConfig) -> Session:
    return config["configurable"]["db"]


def _search_query(state: AgentState, text: str | None = None, page_size: int = MAX_PRODUCTS) -> dict[str, Any]:
    f = state.get("filters") or {}
    return {
        "q": text if text is not None else state["message"],
        "vertical": f.get("vertical"),
        "category": f.get("category"),
        "gender": f.get("gender"),
        "brand": [f["brand"]] if f.get("brand") else None,
        "color": f.get("color"),
        "min_price": f.get("min_price"),
        "max_price": f.get("max_price"),
        "on_sale": bool(f.get("on_sale")),
        "sort": f.get("sort") or "relevance",
        "page": 1,
        "page_size": page_size,
    }


# ---------------------------------------------------------------- memory
def load_context(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    memory = get_memory()
    db = _db(config)
    history = memory.history(db, state["session_id"])
    recalled = memory.recall(state["session_id"], state.get("user_id"), state["message"])
    return {"history": history, "recalled": recalled, "trace": [f"memory: loaded {len(history)} turns"]}


def save_context(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    products = state.get("products") or []
    meta = {
        "intent": state.get("intent"),
        "filters": state.get("filters") or {},
        "product_ids": [p["id"] for p in products][:MAX_PRODUCTS],
        "prices": [p["price"] for p in products][:MAX_PRODUCTS],
    }
    try:
        get_memory().save(_db(config), state["session_id"], state.get("user_id"), state["message"], state.get("answer", ""), meta)
    except Exception as exc:  # noqa: BLE001 - memory failure must not break the reply
        log.warning("Failed to save chat memory: %s", exc)
        _db(config).rollback()
    return {"trace": ["memory: saved"]}


# ---------------------------------------------------------------- router
def understand(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    brands = product_service.known_brands(_db(config))
    intent, filters, cheaper_only, used_llm = intent_mod.understand(
        state["message"], state.get("history") or [], brands, bool(state.get("product_id"))
    )
    return {
        "intent": intent,
        "filters": filters,
        "cheaper_only": cheaper_only,
        "used_llm": used_llm,
        "trace": [f"router: intent={intent} via {'llm' if used_llm else 'rules'}"],
    }


def route(state: AgentState) -> str:
    return {
        "compare": "comparison_agent",
        "deals": "deal_agent",
        "price_drops": "deal_agent",
        "sales_overview": "deal_agent",
        "greeting": "chat_assistant",
    }.get(state.get("intent", "search"), "search_agent")


# ---------------------------------------------------------------- agent 1: search
def search_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    db = _db(config)
    result = product_service.search_products(db, query=_search_query(state))
    items = result["items"]
    # Too narrow? Relax the free text and keep only structured filters.
    if not items and state.get("filters"):
        result = product_service.list_products(db, query={k: v for k, v in _search_query(state, text="").items() if k != "q"})
        items = result["items"]
    return {"products": items, "trace": [f"search_agent: {result['total']} matches"]}


# ---------------------------------------------------------------- agent 2: comparison
def _resolve_product_id(state: AgentState, db: Session) -> int | None:
    if state.get("product_id"):
        return state["product_id"]
    # Did the user name a product? Search for it.
    ref = (state.get("filters") or {}).get("product_reference")
    message = state["message"]
    text = ref or message
    cleaned = re.sub(
        r"\b(cheaper|alternatives?|similar|compare|to|for|like|than|this|instead of|show|me|find|options?)\b", " ", text, flags=re.I
    )
    if len(cleaned.split()) >= 2:
        result = product_service.search_products(db, query={"q": cleaned.strip(), "page_size": 1})
        if result["items"]:
            return result["items"][0]["id"]
    # Fall back to the last product shown in this conversation.
    for turn in reversed(state.get("history") or []):
        ids = turn.get("meta", {}).get("product_ids")
        if ids:
            return ids[0]
    return None


def comparison_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    db = _db(config)
    pid = _resolve_product_id(state, db)
    if not pid:
        out = search_agent(state, config)
        out["trace"] = ["comparison_agent: no product to compare; delegated to search", *out["trace"]]
        return out
    try:
        comp = comparison_service.find_alternatives(
            db, product_id=pid, limit=MAX_PRODUCTS, cheaper_only=bool(state.get("cheaper_only")), other_brands_only=True
        )
    except AppError as exc:
        return {"comparison": None, "products": [], "trace": [f"comparison_agent: {exc.message}"]}
    products = [a["product"] for a in comp["alternatives"]]
    return {"comparison": comp, "products": products, "trace": [f"comparison_agent: {len(products)} alternatives for #{pid}"]}


# ---------------------------------------------------------------- agent 3: deals
def deal_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    db = _db(config)
    f = state.get("filters") or {}
    intent = state.get("intent")
    if intent == "sales_overview":
        overview = deal_service.sales_overview(db, vertical=f.get("vertical"))
        return {"overview": overview, "products": overview["top_deals"][:MAX_PRODUCTS], "trace": ["deal_agent: sales overview"]}
    if intent == "price_drops":
        drops = deal_service.get_price_drops(db, days=14, limit=MAX_PRODUCTS, vertical=f.get("vertical"))
        products = [{**d["product"], "old_price": d["old_price"], "drop_percentage": d["drop_percentage"]} for d in drops]
        return {"products": products, "trace": [f"deal_agent: {len(drops)} price drops"]}
    query = {k: v for k, v in _search_query(state, text="").items() if k != "q"}
    query["sort"] = f.get("sort") if f.get("sort") in {"price_asc", "savings", "newest"} else "discount"
    deals = deal_service.get_deals(db, query=query)
    return {"products": deals["items"], "trace": [f"deal_agent: {deals['total']} deals"]}


# ---------------------------------------------------------------- agent 4: chat assistant
ASSISTANT_PROMPT = """You are Parakh, a friendly shopping assistant that compares products and sales across Pakistani online stores.
Answer using ONLY the data in CONTEXT. Prices are in PKR; write them like "Rs 2,499".
Be concise (max ~120 words): one-line takeaway, then up to 5 bullet picks with store, price and discount if any.
For comparisons, point out the cheapest option and how much it saves. If CONTEXT is empty, say you found nothing and suggest how to broaden the search.
Never invent products, prices or stores."""


def _money(v: Any) -> str:
    return f"Rs {float(v):,.0f}"


def _bullet(p: dict[str, Any]) -> str:
    line = f"• {p['product_name']} — {_money(p['price'])} at {p.get('store_name') or p['brand_name']}"
    if p.get("drop_percentage"):
        line += f" (dropped {p['drop_percentage']:.0f}% from {_money(p['old_price'])})"
    elif p.get("discount_percentage"):
        line += f" ({p['discount_percentage']:.0f}% off, was {_money(p['original_price'])})"
    return line


def _describe_filters(f: dict[str, Any]) -> str:
    parts = []
    if f.get("color"):
        parts.append(f["color"])
    if f.get("category"):
        parts.append(f["category"].replace("-", " "))
    elif f.get("vertical"):
        parts.append(f"{f['vertical']} items")
    else:
        parts.append("items")
    if f.get("gender"):
        parts.append(f"for {f['gender']}")
    if f.get("brand"):
        parts.append(f"from {f['brand']}")
    if f.get("min_price") and f.get("max_price"):
        parts.append(f"between {_money(f['min_price'])} and {_money(f['max_price'])}")
    elif f.get("max_price"):
        parts.append(f"under {_money(f['max_price'])}")
    elif f.get("min_price"):
        parts.append(f"above {_money(f['min_price'])}")
    return " ".join(parts)


def template_answer(state: AgentState) -> str:
    intent = state.get("intent")
    products = state.get("products") or []
    f = state.get("filters") or {}
    if intent == "greeting":
        return (
            "Assalam o Alaikum! I'm Parakh. I compare prices and sales across Pakistani stores — clothes, shoes, "
            "electronics, beauty and home. Try “best kurtas under 3000 for women”, “earbuds on sale”, "
            "“which stores have sales right now?” or open a product and ask for cheaper alternatives."
        )
    if intent == "compare" and state.get("comparison"):
        comp = state["comparison"]
        lines = [
            comp["summary"],
            *[_bullet(a["product"]) + (" — same product" if a["match_type"] == "same_product" else "") for a in comp["alternatives"][:5]],
        ]
        return "\n".join(lines)
    if intent == "sales_overview" and state.get("overview"):
        ov = state["overview"]
        stores = [s for s in ov["stores"] if s["on_sale"]][:6]
        lines = [
            f"{ov['total_on_sale']:,} of {ov['total_products']:,} products are on sale right now (average {ov['average_discount']:.0f}% off)."
        ]
        lines += [f"• {s['name']}: {s['on_sale']} items on sale, up to {s['max_discount']:.0f}% off" for s in stores]
        if products:
            lines.append("Biggest discounts:")
            lines += [_bullet(p) for p in products[:3]]
        return "\n".join(lines)
    if not products:
        return f"I couldn't find {_describe_filters(f)} right now. Try a higher budget, a broader category, or removing the brand/colour."
    if intent == "price_drops":
        head = "Recent price drops:"
    elif intent == "deals":
        head = f"Top deals on {_describe_filters(f)}:"
    else:
        head = f"Here are {_describe_filters(f)} I found:"
    return "\n".join([head, *[_bullet(p) for p in products[:5]]])


def _suggestions(state: AgentState) -> list[str]:
    intent = state.get("intent")
    f = state.get("filters") or {}
    cat = (f.get("category") or "items").replace("-", " ")
    if intent == "compare":
        return ["Show only cheaper ones", f"Best value {cat}", f"{cat} on sale"]
    if intent in {"deals", "price_drops", "sales_overview"}:
        return ["Which stores have sales?", "Recent price drops", "Electronics on sale"]
    if intent == "greeting":
        return ["Best shirts under 3000", "Earbuds on sale", "Which stores have sales?"]
    return [f"Cheaper {cat}", f"{cat} on sale", "Compare alternatives to the first one"]


def chat_assistant(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    fallback = template_answer(state)
    answer, used = fallback, False
    llm = get_llm()
    if llm.enabled and state.get("intent") != "greeting":
        keys = (
            "id",
            "product_name",
            "brand_name",
            "store_name",
            "price",
            "original_price",
            "discount_percentage",
            "category",
            "color",
            "fabric",
            "in_stock",
        )
        context: dict[str, Any] = {
            "intent": state.get("intent"),
            "filters": state.get("filters"),
            "products": [{k: p.get(k) for k in keys} for p in (state.get("products") or [])[:MAX_PRODUCTS]],
        }
        if state.get("comparison"):
            context["comparison_summary"] = state["comparison"]["summary"]
        if state.get("overview"):
            context["stores_on_sale"] = [{k: s[k] for k in ("name", "on_sale", "max_discount")} for s in state["overview"]["stores"][:8]]
        messages = [{"role": "system", "content": ASSISTANT_PROMPT}]
        if state.get("recalled"):
            messages.append({"role": "system", "content": "Things the user told you before:\n" + "\n".join(state["recalled"][:3])})
        messages += [{"role": h["role"], "content": h["content"][:500]} for h in (state.get("history") or [])[-4:]]
        messages.append({"role": "user", "content": f"{state['message']}\n\nCONTEXT:\n{json.dumps(context, default=str)}"})
        reply = llm.complete(messages, max_tokens=500)
        if reply and reply.strip():
            answer, used = reply.strip(), True
    return {
        "answer": answer,
        "suggestions": _suggestions(state),
        "used_llm": bool(state.get("used_llm")) or used,
        "trace": [f"chat_assistant: {'llm' if used else 'template'} answer"],
    }
