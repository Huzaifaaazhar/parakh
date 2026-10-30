import pytest

from app.services.query_parser import parse_query


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("best shirts under 3000 for men", {"category": "shirt", "gender": "men", "max_price": 3000}),
        ("black kurtas for women between 2k and 5k", {"category": "kurta", "color": "black", "min_price": 2000, "max_price": 5000}),
        ("2-5k sandals", {"category": "sandals", "min_price": 2000, "max_price": 5000}),
        ("laptops around 150k", {"category": "laptop", "min_price": 120000, "max_price": 180000}),
        ("phones under 1 lac", {"category": "smartphone", "max_price": 100000}),
        ("sneakers above 5000", {"category": "sneakers", "min_price": 5000}),
    ],
)
def test_price_and_category(query, expected):
    f = parse_query(query)
    for key, value in expected.items():
        assert getattr(f, key) == value, (query, key, getattr(f, key))


def test_intent_words_set_sort():
    assert parse_query("cheapest earbuds").sort == "price_asc"
    assert parse_query("best value kurta").sort == "value"
    f = parse_query("kids shoes on sale")
    assert f.on_sale and f.sort == "discount" and f.gender == "kids"


def test_brand_detection():
    assert parse_query("outfitters jeans", known_brands=["Outfitters", "Engine"]).brand == "Outfitters"
