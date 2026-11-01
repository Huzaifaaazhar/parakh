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
        ("chicken tikka under 800", "search"),
        ("where is zinger burger cheaper at other restaurants", "compare"),
        ("burger deals", "deals"),
        ("pizza offers", "deals"),
        ("show me recent price drops", "price_drops"),
        ("which restaurants have offers right now?", "sales_overview"),
    ],
)
def test_rule_intents(message, intent):
    assert rule_intent(message, has_product_context=False) == intent


def test_product_context_makes_this_a_comparison():
    assert rule_intent("anything cheaper than this?", has_product_context=True) == "compare"


def test_chat_search_without_llm(client):
    data = chat(client, "chicken tikka under 700")
    assert data["intent"] == "search" and not data["used_llm"]
    assert data["products"] and all(p["price"] <= 700 and p["category"] == "tikka" for p in data["products"])
    assert "Rs" in data["answer"]
    assert any("search_agent" in step for step in data["agent_trace"])


def test_chat_comparison_by_name(client):
    data = chat(client, "compare Seekh Kabab (4 pcs) at other restaurants")
    assert data["intent"] == "compare"
    assert data["comparison"] and data["comparison"]["base"]["category"] == "kabab"
    assert all(p["category"] == "kabab" for p in data["products"])
    assert "per piece" in data["answer"]


def test_chat_comparison_with_page_context(client, product_id):
    pid = product_id("chicken karahi half")
    data = chat(client, "is there anything cheaper?", product_id=pid)
    assert data["intent"] == "compare" and data["comparison"]["base"]["id"] == pid


def test_chat_deals_and_offers(client):
    deals = chat(client, "burger deals")
    assert deals["intent"] == "deals" and deals["products"]
    assert all(p["category"] == "deal" for p in deals["products"])
    offers = chat(client, "which restaurants have offers?")
    assert offers["intent"] == "sales_overview" and "Tikka House (demo)" in offers["answer"]


def test_chat_memory_follow_up(client):
    sid = uuid.uuid4().hex
    first = chat(client, "chicken tikka", session_id=sid)
    assert first["filters"]["category"] == "tikka"
    follow = chat(client, "show cheaper ones", session_id=sid)
    assert follow["filters"]["category"] == "tikka"
    assert max(p["price"] for p in follow["products"]) <= max(p["price"] for p in first["products"])


def test_chat_no_results_is_graceful(client):
    data = chat(client, "mutton karahi under 100")
    assert data["products"] == [] or all(p["price"] <= 100 for p in data["products"])
    assert data["answer"]


def test_llm_output_is_sanitised():
    out = sanitize_llm_filters(
        {"intent": "drop table", "category": "spaceship", "protein": "robots", "max_price": "3000", "sort": "price_asc", "brand": "Tooso"}
    )
    assert out == {"max_price": 3000.0, "sort": "price_asc", "brand": "Tooso"}


class FakeLLM:
    enabled = True

    def __init__(self):
        self.calls = []

    def complete(self, messages, *, fast=False, json_mode=False, max_tokens=700):
        self.calls.append({"fast": fast, "json": json_mode})
        if json_mode:
            return json.dumps({"intent": "search", "category": "burger", "protein": "beef", "max_price": 1500, "sort": "price_asc"})
        return "Here are the best beef burgers for you."


def test_chat_with_llm(monkeypatch, client):
    fake = FakeLLM()
    monkeypatch.setattr("app.agents.intent.get_llm", lambda: fake)
    monkeypatch.setattr("app.agents.nodes.get_llm", lambda: fake)
    data = chat(client, "something with a beef patty, not too pricey")
    assert data["used_llm"]
    assert data["filters"]["category"] == "burger" and data["filters"]["max_price"] == 1500
    assert data["filters"]["protein"] == "beef"
    assert data["answer"] == "Here are the best beef burgers for you."
    prices = [p["price"] for p in data["products"]]
    assert prices and prices == sorted(prices) and max(prices) <= 1500
    assert fake.calls[0] == {"fast": True, "json": True}


def test_llm_failure_falls_back_to_rules(monkeypatch, client):
    class Broken(FakeLLM):
        def complete(self, *a, **k):
            return None

    monkeypatch.setattr("app.agents.intent.get_llm", lambda: Broken())
    monkeypatch.setattr("app.agents.nodes.get_llm", lambda: Broken())
    data = chat(client, "zinger burger under 1000")
    assert not data["used_llm"] and data["products"]
