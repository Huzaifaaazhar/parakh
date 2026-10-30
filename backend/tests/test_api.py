def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] is True


def test_list_products_with_filters(client):
    r = client.get("/api/products", params={"vertical": "fashion", "gender": "men", "max_price": 4000, "sort": "price_asc"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] > 0
    prices = [p["price"] for p in data["items"]]
    assert prices == sorted(prices) and max(prices) <= 4000
    assert all(p["vertical"] == "fashion" and p["gender"] in {"men", "unisex"} for p in data["items"])


def test_list_products_pagination_and_validation(client):
    page1 = client.get("/api/products", params={"page_size": 5}).json()
    page2 = client.get("/api/products", params={"page_size": 5, "page": 2}).json()
    assert len(page1["items"]) == 5 and page1["pages"] > 1
    assert {p["id"] for p in page1["items"]}.isdisjoint({p["id"] for p in page2["items"]})
    assert client.get("/api/products", params={"page_size": 1000}).status_code == 422
    assert client.get("/api/products", params={"sort": "bogus"}).status_code == 422


def test_search_parses_natural_language(client):
    r = client.get("/api/products/search", params={"q": "best shirts under 3000 for men"})
    assert r.status_code == 200
    data = r.json()
    assert data["parsed_filters"]["category"] == "shirt"
    assert data["parsed_filters"]["max_price"] == 3000
    assert data["items"] and all(p["category"] == "shirt" and p["price"] <= 3000 for p in data["items"])


def test_search_electronics(client):
    data = client.get("/api/products/search", params={"q": "samsung galaxy"}).json()
    assert data["items"] and "Samsung" in data["items"][0]["product_name"]


def test_product_detail_and_404(client, product_id):
    pid = product_id("samsung galaxy a15")
    r = client.get(f"/api/products/{pid}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["price_history"] and detail["lowest_price"] <= detail["price"]
    assert client.get("/api/products/999999").status_code == 404


def test_facets(client):
    data = client.get("/api/products/facets").json()
    verticals = {f["value"] for f in data["verticals"]}
    assert {"fashion", "electronics", "beauty", "home"} <= verticals
    assert data["price_max"] > data["price_min"]


def test_compare_finds_same_product_in_other_store(client, product_id):
    pid = product_id("samsung galaxy a15")
    r = client.post("/api/compare", json={"product_id": pid})
    assert r.status_code == 200
    data = r.json()
    assert data["alternatives"]
    same = [a for a in data["alternatives"] if a["match_type"] == "same_product"]
    assert same and same[0]["product"]["store_id"] != data["base"]["store_id"]
    assert all(a["product"]["store_id"] != data["base"]["store_id"] for a in data["alternatives"])
    assert data["summary"]


def test_compare_cheaper_only(client, product_id):
    pid = client.get("/api/products", params={"category": "kurta", "sort": "price_desc", "page_size": 1}).json()["items"][0]["id"]
    data = client.post("/api/compare", json={"product_id": pid, "cheaper_only": True}).json()
    assert data["alternatives"]
    assert all(a["is_cheaper"] and a["price_difference"] < 0 for a in data["alternatives"])
    assert all(a["product"]["category"] == "kurta" for a in data["alternatives"])


def test_compare_side_by_side(client):
    items = client.get("/api/products", params={"category": "earbuds", "page_size": 3}).json()["items"]
    r = client.post("/api/compare", json={"product_ids": [p["id"] for p in items]})
    assert r.status_code == 200
    data = r.json()
    assert len(data["products"]) == 3
    price_row = next(row for row in data["rows"] if row["attribute"] == "Price")
    cheapest = min(range(3), key=lambda i: items[i]["price"])
    assert price_row["best_index"] == cheapest


def test_compare_validation(client):
    assert client.post("/api/compare", json={}).status_code == 422
    assert client.post("/api/compare", json={"product_id": 999999}).status_code == 404


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


def test_sales_overview_and_stores(client):
    data = client.get("/api/sales").json()
    assert data["total_on_sale"] > 0 and data["stores"]
    assert any(s["on_sale"] > 0 for s in data["stores"])
    stores = client.get("/api/stores").json()
    assert {"slug", "on_sale", "max_discount"} <= set(stores[0])


def test_auth_wishlist_and_price_alert(client, db, product_id):
    from sqlalchemy import select

    from app.models import Product
    from app.scrapers.base import StoreConfig
    from app.services.ingestion import ingest_products
    from app.services.normalization.normalizer import RawProduct
    from app.workers.tasks import generate_price_alerts

    r = client.post("/api/auth/register", json={"email": "ali@example.com", "password": "secret123", "name": "Ali"})
    assert r.status_code == 201
    token = r.json()["access_token"]
    assert client.post("/api/auth/register", json={"email": "ali@example.com", "password": "secret123"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "ali@example.com", "password": "wrong-pass"}).status_code == 401
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "ali@example.com"
    assert client.get("/api/wishlist").status_code == 401

    cfg = StoreConfig("alert-test", "Alert Store", "https://alert.pk", verticals=["electronics"])
    ingest_products(db, cfg, [RawProduct("p1", "Alert TWS Earbuds", "https://alert.pk/p1", price=5000)])
    db.commit()
    pid = db.scalar(select(Product.id).where(Product.external_id == "p1"))
    generate_price_alerts()  # clear the backlog of existing events

    assert client.post("/api/wishlist", json={"product_id": pid, "target_price": 4500}, headers=headers).status_code == 201
    assert len(client.get("/api/wishlist", headers=headers).json()) == 1

    ingest_products(db, cfg, [RawProduct("p1", "Alert TWS Earbuds", "https://alert.pk/p1", price=4000, original_price=5000)])
    db.commit()
    assert generate_price_alerts() == 1
    notes = client.get("/api/notifications", headers=headers).json()
    assert notes and "dropped 20%" in notes[0]["message"]

    assert client.delete(f"/api/wishlist/{pid}", headers=headers).status_code == 204
    assert client.get("/api/wishlist", headers=headers).json() == []


def test_admin_endpoints_require_key(client):
    assert client.post("/api/admin/scrape").status_code == 403
    assert client.get("/api/admin/scrape-runs", headers={"X-Admin-Key": "test-secret"}).status_code == 200


def test_compare_never_mixes_kids_and_adults(db, client):
    """Regression: gender-unknown adult items were compared with children's clothes."""
    from sqlalchemy import select

    from app.models import Product
    from app.scrapers.base import StoreConfig
    from app.services.indexing import index_products
    from app.services.ingestion import ingest_products
    from app.services.normalization.normalizer import RawProduct

    def shirt(store, ext, title, price, tags=(), sizes=("S", "M", "L")):
        return RawProduct(ext, title, f"https://{store}.pk/p/{ext}", price=price, tags=list(tags), options={"size": list(sizes)})

    a = StoreConfig("aud-a", "Audience A", "https://a.pk", verticals=["fashion"])
    b = StoreConfig("aud-b", "Audience B", "https://b.pk", verticals=["fashion"])
    c = StoreConfig("aud-c", "Audience C", "https://c.pk", verticals=["fashion"], default_gender="women")
    ingest_products(db, a, [shirt("a", "u1", "Zebra Stripe Casual Shirt", 3000, tags=["Sale"])])  # unknown audience
    ingest_products(
        db,
        b,
        [
            shirt("b", "k1", "Zebra Stripe Casual Shirt", 2900, tags=["kids"], sizes=["6-7Y", "8-9Y"]),
            shirt("b", "m1", "Men Zebra Stripe Casual Shirt", 3100),
        ],
    )
    ingest_products(db, c, [shirt("c", "w1", "Zebra Stripe Casual Shirt", 3050)])
    db.commit()
    ids = {p.external_id: p for p in db.scalars(select(Product).where(Product.external_id.in_(["u1", "k1", "m1", "w1"])))}
    assert ids["k1"].gender == "kids" and ids["w1"].gender == "women" and ids["u1"].gender is None
    index_products(db, [p.id for p in ids.values()])

    def alt_genders(pid):
        data = client.post("/api/compare", json={"product_id": pid, "limit": 50}).json()
        return {
            a["product"]["external_id"] if "external_id" in a["product"] else a["product"]["id"]: a["product"]["gender"]
            for a in data["alternatives"]
        }

    # Unknown-audience adult shirt: never matched with the kids' shirt.
    assert "kids" not in alt_genders(ids["u1"].id).values()
    # Kids' shirt: only kids' alternatives.
    assert set(alt_genders(ids["k1"].id).values()) <= {"kids"}
    # Men's shirt: no women's or kids' items.
    assert set(alt_genders(ids["m1"].id).values()) <= {"men", "unisex", None}
