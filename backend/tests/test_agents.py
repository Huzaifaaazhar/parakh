import json
import uuid

import pytest

from app.agents.intent import rule_intent, sanitize_llm_filters


def chat(client, message, session_id=None, product_id=None):
    r = client.post("/api/chat", json={"message": message, "session_id": session_id, "product_id": product_id})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize(
    ("message", "intent"),
    [
        ("hi", "greeting"),
        ("best shirts under 3000", "search"),
        ("cheaper alternatives to Samsung Galaxy A15", "compare"),
        ("earbuds on sale", "deals"),
        ("show me recent price drops", "price_drops"),
        ("which stores have sales right now?", "sales_overview"),
    ],
)
def test_rule_intents(message, intent):
    assert rule_intent(message, has_product_context=False) == intent


def test_product_context_makes_this_a_comparison():
    assert rule_intent("anything cheaper than this?", has_product_context=True) == "compare"


def test_chat_search_without_llm(client):
    data = chat(client, "best shirts under 3000 for men")
    assert data["intent"] == "search" and not data["used_llm"]
    assert data["products"] and all(p["price"] <= 3000 and p["category"] == "shirt" for p in data["products"])
    assert "Rs" in data["answer"]
    assert any("search_agent" in step for step in data["agent_trace"])


def test_chat_comparison_by_name(client):
    data = chat(client, "cheaper alternatives to Samsung Galaxy A15")
    assert data["intent"] == "compare"
    assert data["comparison"] and data["comparison"]["base"]["product_name"].startswith("Samsung Galaxy A15")
    assert all(p["price"] < data["comparison"]["base"]["price"] for p in data["products"])


def test_chat_comparison_with_page_context(client, product_id):
    pid = product_id("lenovo lp40 earbuds")
    data = chat(client, "is there anything similar?", product_id=pid)
    assert data["intent"] == "compare" and data["comparison"]["base"]["id"] == pid


def test_chat_deals_and_overview(client):
    deals = chat(client, "earbuds on sale")
    assert deals["intent"] == "deals" and all(p["discount_percentage"] > 0 for p in deals["products"])
    overview = chat(client, "which stores have sales?")
    assert overview["intent"] == "sales_overview" and "on sale" in overview["answer"]


def test_chat_memory_follow_up(client):
    sid = uuid.uuid4().hex
    first = chat(client, "kurtas for women", session_id=sid)
    assert first["filters"]["category"] == "kurta"
    follow = chat(client, "show cheaper ones", session_id=sid)
    assert follow["filters"]["category"] == "kurta" and follow["filters"]["gender"] == "women"
    assert max(p["price"] for p in follow["products"]) < max(p["price"] for p in first["products"])


def test_chat_no_results_is_graceful(client):
    data = chat(client, "laptops under 500")
    assert data["products"] == [] or all(p["price"] <= 500 for p in data["products"])
    assert data["answer"]


def test_llm_output_is_sanitised():
    out = sanitize_llm_filters(
        {"intent": "drop table", "category": "spaceship", "gender": "robots", "max_price": "3000", "sort": "price_asc", "brand": "Engine"}
    )
    assert out == {"max_price": 3000.0, "sort": "price_asc", "brand": "Engine"}


class FakeLLM:
    enabled = True

    def __init__(self):
        self.calls = []

    def complete(self, messages, *, fast=False, json_mode=False, max_tokens=700):
        self.calls.append({"fast": fast, "json": json_mode})
        if json_mode:
            return json.dumps({"intent": "search", "category": "sneakers", "gender": "men", "max_price": 6000, "sort": "price_asc"})
        return "Here are the best sneakers for you."


def test_chat_with_llm(monkeypatch, client):
    fake = FakeLLM()
    monkeypatch.setattr("app.agents.intent.get_llm", lambda: fake)
    monkeypatch.setattr("app.agents.nodes.get_llm", lambda: fake)
    data = chat(client, "I need joggers... I mean running shoes, not too pricey")
    assert data["used_llm"]
    assert data["filters"]["category"] == "sneakers" and data["filters"]["max_price"] == 6000
    assert data["answer"] == "Here are the best sneakers for you."
    prices = [p["price"] for p in data["products"]]
    assert prices and prices == sorted(prices) and max(prices) <= 6000
    assert fake.calls[0] == {"fast": True, "json": True}


def test_llm_failure_falls_back_to_rules(monkeypatch, client):
    class Broken(FakeLLM):
        def complete(self, *a, **k):
            return None

    monkeypatch.setattr("app.agents.intent.get_llm", lambda: Broken())
    monkeypatch.setattr("app.agents.nodes.get_llm", lambda: Broken())
    data = chat(client, "earbuds under 4000")
    assert not data["used_llm"] and data["products"]
