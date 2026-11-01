def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] is True


def test_list_dishes_with_filters(client):
    r = client.get("/api/products", params={"category": "tikka", "max_price": 800, "sort": "price_asc"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] > 0
    prices = [p["price"] for p in data["items"]]
    assert prices == sorted(prices) and max(prices) <= 800
    assert all(p["category"] == "tikka" and p["protein"] == "chicken" for p in data["items"])


def test_protein_and_city_filters(client):
    beef = client.get("/api/products", params={"protein": "beef"}).json()["items"]
    assert beef and all(p["protein"] == "beef" for p in beef)
    isb = client.get("/api/products", params={"city": "islamabad", "page_size": 100}).json()["items"]
    assert isb and {p["store_slug"] for p in isb} <= {"karahi-point", "bun-studio", "oven-works"}


def test_list_products_pagination_and_validation(client):
    page1 = client.get("/api/products", params={"page_size": 5}).json()
    page2 = client.get("/api/products", params={"page_size": 5, "page": 2}).json()
    assert len(page1["items"]) == 5 and page1["pages"] > 1
    assert {p["id"] for p in page1["items"]}.isdisjoint({p["id"] for p in page2["items"]})
    assert client.get("/api/products", params={"page_size": 1000}).status_code == 422
    assert client.get("/api/products", params={"sort": "bogus"}).status_code == 422


def test_search_parses_natural_language(client):
    r = client.get("/api/products/search", params={"q": "chicken tikka under 700"})
    assert r.status_code == 200
    data = r.json()
    assert data["parsed_filters"]["category"] == "tikka"
    assert data["parsed_filters"]["max_price"] == 700
    assert data["items"] and all(p["category"] == "tikka" and p["price"] <= 700 for p in data["items"])


def test_dish_payload_has_portion_and_unit_price(client):
    kabab = client.get("/api/products/search", params={"q": "seekh kabab"}).json()["items"][0]
    assert kabab["portion"] == "4 pcs"
    assert kabab["unit_label"] == "per piece" and kabab["unit_price"] == round(kabab["price"] / 4, 1)
    pizza = client.get("/api/products/search", params={"q": "large chicken tikka pizza"}).json()["items"][0]
    assert pizza["category"] == "pizza" and pizza["unit_label"] == "per 100 sq in"


def test_product_detail_and_404(client, product_id):
    pid = product_id("mutton karahi half")
    r = client.get(f"/api/products/{pid}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["price_history"] and detail["lowest_price"] <= detail["price"]
    assert client.get("/api/products/999999").status_code == 404


def test_facets(client):
    data = client.get("/api/products/facets").json()
    dishes = {f["value"] for f in data["categories"]}
    assert {"tikka", "karahi", "burger", "pizza", "deal"} <= dishes
    assert {"chicken", "beef", "mutton"} <= {f["value"] for f in data["proteins"]}
    assert {"Lahore", "Karachi", "Islamabad"} <= {f["value"] for f in data["cities"]}
    assert data["price_max"] > data["price_min"]


def _dish(client, q):
    return client.get("/api/products/search", params={"q": q, "page_size": 50}).json()["items"]


def test_compare_same_dish_across_restaurants(client):
    leg = next(p for p in _dish(client, "chicken tikka leg") if "Leg" in p["product_name"])
    data = client.post("/api/compare", json={"product_id": leg["id"]}).json()
    alts = data["alternatives"]
    assert alts and data["summary"]
    assert all(a["product"]["category"] == "tikka" for a in alts)
    assert all(a["product"]["store_id"] != leg["store_id"] for a in alts)
    same = [a for a in alts if a["match_type"] == "same_dish"]
    assert same and all("Leg" in a["product"]["product_name"] for a in same)


def test_compare_never_mixes_protein_or_half_and_full(client):
    half = next(p for p in _dish(client, "chicken karahi half") if "Half" in p["product_name"])
    alts = client.post("/api/compare", json={"product_id": half["id"], "limit": 50}).json()["alternatives"]
    names = [a["product"]["product_name"] for a in alts]
    assert names and all("Half" in n for n in names)  # never a full karahi
    assert not any("Mutton" in n for n in names)  # never another protein
    beef = next(p for p in _dish(client, "beef tikka boti") if p["protein"] == "beef")
    for a in client.post("/api/compare", json={"product_id": beef["id"], "limit": 50}).json()["alternatives"]:
        assert a["product"]["protein"] in {"beef", None}


def test_compare_pizza_sizes_stay_close(client):
    large = next(p for p in _dish(client, "chicken tikka pizza large") if "Large" in p["product_name"])
    alts = client.post("/api/compare", json={"product_id": large["id"], "limit": 50}).json()["alternatives"]
    assert alts and all("Small" not in a["product"]["product_name"] for a in alts)


def test_compare_cheaper_only(client):
    priciest = client.get("/api/products", params={"category": "burger", "sort": "price_desc", "page_size": 1}).json()["items"][0]
    data = client.post("/api/compare", json={"product_id": priciest["id"], "cheaper_only": True}).json()
    assert all(a["is_cheaper"] and a["price_difference"] < 0 for a in data["alternatives"])
    assert all(a["product"]["category"] == "burger" for a in data["alternatives"])


def test_compare_side_by_side_marks_cheapest_and_unit_price(client):
    items = [p for p in _dish(client, "seekh kabab") if p["category"] == "kabab"][:3]
    r = client.post("/api/compare", json={"product_ids": [p["id"] for p in items]})
    assert r.status_code == 200
    rows = {row["attribute"]: row for row in r.json()["rows"]}
    cheapest = min(range(len(items)), key=lambda i: items[i]["price"])
    assert rows["Price"]["best_index"] == cheapest
    assert rows["Price per piece"]["best_index"] == cheapest
    assert rows["Restaurant"]["values"] == [p["store_name"] for p in items]


def test_compare_validation(client):
    assert client.post("/api/compare", json={}).status_code == 422
    assert client.post("/api/compare", json={"product_id": 999999}).status_code == 404


def test_restaurants_and_detail(client):
    rests = client.get("/api/restaurants").json()
    names = {r["name"] for r in rests}
    assert "Tikka House (demo)" in names
    tikka = next(r for r in rests if r["slug"] == "tikka-house")
    assert tikka["menu_items"] > 5 and tikka["offers"][0]["percent"] == 20
    assert tikka["min_price"] <= tikka["median_price"]
    assert [r["slug"] for r in client.get("/api/restaurants", params={"city": "islamabad"}).json()]
    detail = client.get("/api/restaurants/tikka-house").json()
    assert detail["sections"] and any(s["name"] == "BBQ" for s in detail["sections"])
    assert detail["reviews"] and detail["rating_breakdown"]["5"] >= 1
    assert client.get("/api/restaurants/nope").status_code == 404


def test_offers(client):
    data = client.get("/api/offers").json()
    assert {o["restaurant"]["slug"] for o in data["restaurant_offers"]} >= {"tikka-house", "slice-studio"}
    assert data["deal_items"] and all(p["category"] == "deal" for p in data["deal_items"])


def test_deals_sorted_by_discount(client):
    data = client.get("/api/deals", params={"page_size": 10}).json()
    discounts = [p["discount_percentage"] for p in data["items"]]
    assert data["total"] > 0 and all(d > 0 for d in discounts)
    assert discounts == sorted(discounts, reverse=True)


def test_price_drops(client):
    drops = client.get("/api/price-drops", params={"days": 30}).json()
    assert drops
    for d in drops:
        assert d["new_price"] < d["old_price"] and d["drop_percentage"] >= 1


def _register(client, email):
    r = client.post("/api/auth/register", json={"email": email, "password": "secret123", "name": email.split("@")[0].title()})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_reviews_with_photos_and_videos(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "media_dir", str(tmp_path))
    headers = _register(client, "sana@example.com")
    dish = _dish(client, "chicken tikka leg")[0]
    slug = dish["store_slug"]
    files = [
        ("files", ("plate.jpg", b"\xff\xd8\xff fake jpeg", "image/jpeg")),
        ("files", ("bite.mp4", b"\x00\x00\x00 fake mp4", "video/mp4")),
    ]
    form = {"rating": "5", "text": "Smoky and juicy", "product_id": str(dish["id"]), "visited_branch": "MM Alam"}
    assert client.post(f"/api/restaurants/{slug}/reviews", data=form, files=files).status_code == 401
    r = client.post(f"/api/restaurants/{slug}/reviews", data=form, files=files, headers=headers)
    assert r.status_code == 201, r.text
    review = r.json()
    assert review["source"] == "parakh" and review["dish_name"] == dish["product_name"]
    assert [m["type"] for m in review["media"]] == ["photo", "video"]
    stored = review["media"][0]["url"].rsplit("/", 1)[1]
    assert (tmp_path / "reviews" / stored).exists()
    wall = client.get("/api/reviews", params={"with_media": True}).json()
    assert wall and all(w["media"] for w in wall)

    bad = [("files", ("virus.exe", b"MZ", "application/octet-stream"))]
    assert client.post(f"/api/restaurants/{slug}/reviews", data=form, files=bad, headers=headers).status_code == 400
    assert client.post(f"/api/restaurants/{slug}/reviews", data={"rating": "4"}, headers=headers).status_code == 400
    other = _dish(client, "zinger burger")[0]
    wrong_dish = {**form, "product_id": str(other["id"])}
    if other["store_slug"] != slug:
        assert client.post(f"/api/restaurants/{slug}/reviews", data=wrong_dish, headers=headers).status_code == 400


def test_banners_sponsored_first_and_admin_only(client):
    assert client.post("/api/admin/banners", json={"title": "x"}).status_code == 403
    admin = {"X-Admin-Key": "test-secret"}
    body = {"store_slug": "burger-yard", "kind": "sponsored", "title": "Double smash week", "priority": 5}
    r = client.post("/api/admin/banners", json=body, headers=admin)
    assert r.status_code == 201
    banners = client.get("/api/banners").json()
    assert banners[0]["title"] == "Double smash week" and banners[0]["kind"] == "sponsored"
    assert banners[0]["restaurant_slug"] == "burger-yard"
    assert any(b["kind"] == "featured" for b in banners)
    expired = {**body, "title": "Old ad", "ends_at": "2020-01-01T00:00:00Z"}
    client.post("/api/admin/banners", json=expired, headers=admin)
    assert "Old ad" not in {b["title"] for b in client.get("/api/banners").json()}
    assert client.post(f"/api/banners/{banners[0]['id']}/click").status_code == 204


def test_auth_wishlist_and_price_alert(client, db):
    from sqlalchemy import select

    from app.models import Product
    from app.scrapers.base import StoreConfig
    from app.services.ingestion import ingest_products
    from app.services.normalization.normalizer import RawProduct
    from app.workers.tasks import generate_price_alerts

    headers = _register(client, "ali@example.com")
    assert client.post("/api/auth/register", json={"email": "ali@example.com", "password": "secret123"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "ali@example.com", "password": "wrong-pass"}).status_code == 401
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "ali@example.com"
    assert client.get("/api/wishlist").status_code == 401

    cfg = StoreConfig("alert-test", "Alert Grill", "https://alert.pk", verticals=["food"])
    ingest_products(db, cfg, [RawProduct("p1", "Chicken Karahi (Full)", "https://alert.pk/p1", price=3000)])
    db.commit()
    pid = db.scalar(select(Product.id).where(Product.external_id == "p1"))
    generate_price_alerts()  # clear the backlog of existing events

    assert client.post("/api/wishlist", json={"product_id": pid, "target_price": 2800}, headers=headers).status_code == 201
    assert len(client.get("/api/wishlist", headers=headers).json()) == 1

    ingest_products(db, cfg, [RawProduct("p1", "Chicken Karahi (Full)", "https://alert.pk/p1", price=2400, original_price=3000)])
    db.commit()
    assert generate_price_alerts() == 1
    notes = client.get("/api/notifications", headers=headers).json()
    assert notes and "dropped 20%" in notes[0]["message"]

    assert client.delete(f"/api/wishlist/{pid}", headers=headers).status_code == 204
    assert client.get("/api/wishlist", headers=headers).json() == []


def test_admin_endpoints_require_key(client):
    assert client.post("/api/admin/scrape").status_code == 403
    assert client.get("/api/admin/scrape-runs", headers={"X-Admin-Key": "test-secret"}).status_code == 200
