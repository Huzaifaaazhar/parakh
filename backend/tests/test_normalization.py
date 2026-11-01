import pytest

from app.services.normalization.normalizer import RawProduct, clean_title, compute_discount, normalize, parse_price
from app.services.normalization.portion import portion_label, unit_price
from app.services.normalization.taxonomy import detect_category, detect_portion, detect_protein


@pytest.mark.parametrize(
    ("title", "dish"),
    [
        ("Chicken Tikka (Leg)", "tikka"),
        ("Beef Tikka Boti 6 pcs", "boti"),
        ("Malai Boti", "boti"),
        ("Seekh Kabab (4 Pcs)", "kabab"),
        ("Tikka Biryani", "biryani"),
        ("Chicken Tikka Karahi", "karahi"),
        ('Tikka Pizza Large 12"', "pizza"),
        ("Zinger Paratha Roll", "roll-wrap"),
        ("Mighty Zinger", "burger"),
        ("Crispy Chicken (Make it a Meal)", "deal"),
        ("Chicken Manchurian", "chinese"),
        ("Sweet and Sour Chicken", "chinese"),
        ("Spring Rolls (6 pcs)", "starter"),
        ("Hot & Sour Soup (Family Bowl)", "soup"),
        ("Beef Nehari.", "nihari"),
        ("Chargha (Qtr)", "chargha"),
        ("Chocolate Shake", "shake"),
        ("Iced Tea", "drink"),
        ("Dodh Patti", "chai-coffee"),
        ("Pepsi 1.5 Ltr", "drink"),
        ("Kunafa", "dessert"),
        ("Crispy Mayo Drum Sticks", "wings"),
        ("Delulu Beef Sando", "sandwich"),
    ],
)
def test_detect_dish(title, dish):
    assert detect_category(title)[1] == dish


@pytest.mark.parametrize(
    ("text", "protein"),
    [
        ("Beef Tikka", "beef"),
        ("Mutton Karahi (Half)", "mutton"),
        ("Finger Fish", "fish"),
        ("Malai Boti", "chicken"),
        ("Zinger Burger", "chicken"),
        ("Paneer Tikka", "veg"),
        ("Chocolate Shake", None),
    ],
)
def test_detect_protein(text, protein):
    assert detect_protein(text) == protein


def test_detect_portion():
    assert detect_portion("Seekh Kabab (4 Pcs)") == {"pieces": 4}
    assert detect_portion('Fajita Pizza 12"') == {"inches": 12.0}
    assert detect_portion("Mutton Karahi (Half)") == {"size": "half"}
    assert detect_portion("Platter (Serves 4 people)")["serves"] == 4
    assert detect_portion("Pepsi 1.5 Ltr") == {"volume_ml": 1500.0}
    assert detect_portion("Mutton Kunna 1 kg") == {"weight_g": 1000.0}
    assert detect_portion("Chargha (Qtr)") == {"size": "quarter"}


def test_unit_price_and_label():
    assert unit_price(1200, {"pieces": 6}, "kabab") == (200.0, "per piece")
    # A 12" pizza is ~113 sq in, so Rs 2,262 is ~Rs 2,000 per 100 sq in.
    assert unit_price(2262, {"inches": 12}, "pizza") == pytest.approx((2000.1, "per 100 sq in"), abs=1)
    assert unit_price(3000, {"serves": 4}, "deal") == (750.0, "per person")
    assert unit_price(500, {}, "tikka") is None
    assert portion_label({"size": "half", "pieces": 4, "cut": "leg"}) == "Half · 4 pcs · Leg"


def test_parse_price_and_discount():
    assert parse_price("Rs. 1,450") == 1450.0
    assert parse_price("PKR 999.50") == 999.5
    assert parse_price(None) is None
    assert compute_discount(800, 1000) == 20.0
    assert compute_discount(1000, 1000) == 0.0


def test_clean_title_keeps_dish_names():
    assert clean_title("  Chicken   Tikka (Leg) ") == "Chicken Tikka (Leg)"


def _norm(title, section=None, size=None, description=None, cuisines=None, price=500):
    raw = RawProduct(
        external_id="x1",
        title=title,
        url="https://example.pk/item",
        price=price,
        description=description,
        product_type=section,
        extra={"menu_section": section, "size": size},
    )
    return normalize(raw, store_name="Tooso", allowed_verticals=["food"], cuisines=cuisines)


def test_normalize_sized_item_keeps_size_and_cut():
    rec = _norm("Chicken Tikka (Chest)", section="BBQ", size="Chest")
    assert rec["vertical"] == "food" and rec["category"] == "tikka"
    assert rec["attributes"]["protein"] == "chicken"
    assert rec["attributes"]["cut"] == "chest"
    assert rec["attributes"]["menu_section"] == "BBQ"
    assert rec["brand_name"] == "Tooso"


def test_menu_section_rescues_vague_names_and_marks_deals():
    assert (
        _norm("Tooso Overload", section="PLATTERS", description="1 Club Sandwich + 4 Pcs Crispy Chicken + 5 Drinks")["category"] == "deal"
    )
    rec = _norm("Midnight Box", section="Deals", description="2 Zinger Burgers + Fries + 2 Drinks")
    assert rec["category"] == "deal"
    assert rec["attributes"]["deal_parts"] == 3


def test_pizza_place_toppings_become_pizzas():
    assert _norm("Creamy Tikka (Large)", section="Classic Flavors", cuisines=["pizza"])["category"] == "pizza"
    assert _norm("Afghani (Small)", section="Classic Flavors", cuisines=["pizza"])["category"] == "pizza"
    # ...but not at a BBQ place
    assert _norm("Creamy Tikka (Large)", section="BBQ", cuisines=["bbq"])["category"] == "tikka"


def test_add_ons_are_kept_apart():
    assert _norm("Extra Olives", section="EXTRA")["category"] == "add-on"
    assert _norm("Honey Mustard Sauce", section="Snacks")["category"] == "add-on"
    assert _norm("Coleslaw", section="ADD ONS")["category"] == "add-on"
    assert _norm("Extra Cheese Pizza (Large)", section="Pizzas")["category"] == "pizza"


def test_normalize_rejects_unpriced_items():
    assert _norm("Chicken Tikka", price=0) is None
