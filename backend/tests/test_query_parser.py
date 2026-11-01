import pytest

from app.services.query_parser import parse_query


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("chicken tikka under 800", {"category": "tikka", "protein": "chicken", "max_price": 800}),
        ("mutton karahi between 2k and 4k", {"category": "karahi", "protein": "mutton", "min_price": 2000, "max_price": 4000}),
        ("1-2k biryani", {"category": "biryani", "min_price": 1000, "max_price": 2000}),
        ("large pizza around 2500", {"category": "pizza", "min_price": 2000, "max_price": 3000}),
        ("zinger burger under 1k", {"category": "burger", "max_price": 1000}),
        ("seekh kabab above 500", {"category": "kabab", "min_price": 500}),
    ],
)
def test_price_dish_and_protein(query, expected):
    f = parse_query(query)
    for key, value in expected.items():
        assert getattr(f, key) == value, (query, key, getattr(f, key))


def test_tikka_alone_does_not_exclude_beef():
    assert parse_query("tikka").protein is None
    assert parse_query("beef tikka").protein == "beef"


def test_deal_words_mean_bundles_and_offer_words_mean_discounts():
    f = parse_query("beef burger deals")
    assert f.category == "deal" and "burger" in f.keywords
    f = parse_query("pizza offers")
    assert f.on_sale and f.sort == "discount" and f.category == "pizza"


def test_intent_words_set_sort():
    assert parse_query("cheapest biryani").sort == "price_asc"
    assert parse_query("best value karahi").sort == "value"


def test_restaurant_detection():
    assert parse_query("tooso tikka", known_brands=["Tooso", "Burger Lab"]).brand == "Tooso"
