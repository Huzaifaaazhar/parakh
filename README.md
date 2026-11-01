# Parakh — compare the same dish across Pakistani restaurants

**Parakh** (پرکھ, "to assess") compares food across Pakistani restaurants: chicken tikka against chicken tikka, half karahi against half karahi, a large pizza against a large pizza. Background collectors read each restaurant's menu, prices and running offers from its own ordering site, and normalise every item into one dish catalogue. You can then:

- **Compare a dish across restaurants** like for like: same dish, same protein, same portion, with the price per piece, per person or per 100 sq in of pizza where the menu says how much you get.
- **See every deal**: restaurant-wide offers ("20% off delivery"), combo deals ranked by value, discounted dishes and menu price drops.
- **Browse restaurants and their full menus**, with Google ratings and reviews (when a Google Maps key is configured).
- **Read and post reviews with photos and videos** of what actually arrived.
- **Feature restaurants in the home-page banner.** Paid slides are always labelled *Sponsored*; they never change how dishes are ranked.
- **Ask an AI assistant** (LangGraph multi-agent) in plain words: "chicken tikka under 800", "burger deals", "which restaurants have offers?". It works without an LLM too.
- **Save dishes and get price-drop alerts.**

```
                ┌───────────── Celery beat (every 6h) ─────────────┐
                ▼                                                   │
 Restaurant sites ──► Collectors ──► Dish normaliser ──► Ingestion ──► PostgreSQL
 (Indolj: headless     (menu, offers,   dish · protein ·   change detection   restaurants, menu items,
  capture; JSON-LD)     cities)        portion · unit price (new/drop/gone)   price history, reviews,
                                                               │               banner ads
 Google Places API ──► places-sync (rating, address, ≤5 reviews, weekly)     │
                                                               ▼               │
                                       embeddings ─► ChromaDB / LEANN / memory │
                                                               │               │
 Angular + Tailwind ──► FastAPI ──► search · dish comparison · offers · reviews┘
                          │  ▲
                          ▼  │      Redis cache (generation-invalidated)
                       LangGraph agents: router → search | comparison | deal finder → assistant
```

**Rule 1 holds:** user requests never trigger scraping. Requests only read the database, the vector index and the cache.

---

## Where the data comes from

| Source | What we take | How |
| --- | --- | --- |
| **Indolj** ordering sites (Tooso, Student Biryani, Burger Lab, Burger O'Clock, Kababjees Fried Chicken, Kaybees, Hot n Roll, California Pizza, Pizza One, Pizza Nation, Mandi House, Istanbul, Xander's, Chaiwala, Hobnob, Delizia) | Full menu with every size (Half/Full, Chicken/Beef, Leg/Chest), item photos, restaurant-wide offers, delivery cities | The site is opened in headless Chromium and the menu/offers JSON **the page itself loads** is kept (`scrapers/browser_capture.py`, `scrapers/indolj.py`). No tokens are forged and no private APIs are called directly. |
| **schema.org JSON-LD** menus (Bundu Khan, Tossdown sites) | Menu items, prices, photos | Parsed from the page HTML (`scrapers/jsonld.py`). |
| **Google Places API (New)** | Rating, review count, price level, address, phone, Maps link, up to 5 Google reviews with author attribution | Official API only, with `GOOGLE_MAPS_API_KEY`. Google Maps pages are never scraped. Place IDs are kept; everything else is refreshed weekly and Google reviews are replaced, not accumulated, per Google's terms. |
| **Diners on Parakh** | Ratings, text, photos and videos | `POST /api/restaurants/{slug}/reviews` (signed in). JPG/PNG/WebP/HEIC photos and MP4/WebM/MOV videos, up to 6 files of 40 MB each. |

Restaurants are listed in `backend/app/scrapers/restaurants.yaml`. To grow the list:

```bash
python -m app.cli places-discover --city Lahore          # needs GOOGLE_MAPS_API_KEY
python -m app.cli detect-platform kfcpakistan.com optp.pk # which adapter a site can use
```

`places-discover` searches Google Places for restaurants in a city, checks each website's ordering platform and prints ready-to-paste YAML lines for the supported ones (others are printed commented out).

Not yet supported (found during discovery): **Blinkco** sites (OPTP, Hardee's, Howdy, 14th Street Pizza, Sweet Creme) and **KFC** load the menu only after a location is chosen; **Tossdown** HTML sites (Salt'n Pepper, Spice Bazaar, Marhaba) need per-site parsing; Ginsoy left Indolj.

## How dishes are compared (`services/normalization`, `services/comparison_service.py`)

1. **Dish detection** maps menu titles to about 40 dishes (tikka, boti, kabab, chargha, karahi, handi, biryani, burger, pizza, rolls, shawarma, deals…). Rule order handles real menus: a "tikka biryani" is biryani, a "zinger paratha roll" is a roll, "Creamy Tikka (Large)" at a pizza place is a pizza, "Extra Olives" is an extra.
2. **Protein** (chicken, beef, mutton, fish, prawn, veg) and **portion**: pieces, half/full/quarter, small→family, pizza inches, serves N, grams, ml, and the cut (leg/chest).
3. **Matching**: two items are compared only if they are the same dish and protein, and their portion is compatible (half never against full; pizzas within 2"; a 2-item combo never against a 10-item platter). Same dish + protein + portion at another restaurant is flagged **same dish**.
4. **Fair price**: price per piece / per person / per 100 sq in when the menu gives the portion; side-by-side tables mark the best value in each row.

`python -m app.cli renormalize` re-runs dish detection over stored menus after taxonomy changes, without re-scraping.

## Quick start (Docker)

```bash
cp .env.example .env              # add GOOGLE_MAPS_API_KEY for ratings/Google reviews, GROQ_API_KEY etc. for LLM answers
docker compose up --build -d      # db, redis, chroma, migrate, api, worker, beat, frontend

docker compose exec api python -m app.cli seed-demo    # fictional "(demo)" restaurants, offline
docker compose exec api python -m app.cli scrape       # real restaurant menus (~5 minutes)
docker compose exec api python -m app.cli places-sync  # Google ratings + reviews (needs the key)
```

- App: http://localhost:8080 · API docs: http://localhost:8000/docs
- The backend image includes headless Chromium (`INSTALL_BROWSERS=true`), which menu capture needs. An API-only image can build with `INSTALL_BROWSERS=false`.
- Celery beat re-reads every menu every `SCRAPE_INTERVAL_HOURS` (default 6) and refreshes Google data weekly.

## Local development

Requirements: Python 3.12+, Node 24, PostgreSQL 16 (or SQLite for a quick look), Redis 7 (optional).

```bash
cd backend
pip install -r requirements-dev.txt && scrapling install     # Chromium for menu capture
alembic upgrade head
python -m app.cli scrape tooso burger-lab                     # or: seed-demo
uvicorn app.main:app --reload

cd frontend && npm install && npm start                       # http://localhost:4200, proxies /api
```

### Tests

```bash
cd backend && pytest          # 101 tests: dish detection, portions, query parsing, collectors, ingestion, comparison, reviews, banners, agents
cd frontend && npx ng build   # type-checks templates
```

Tests run offline (SQLite, in-memory vectors, hashing embedder, fake fetchers, mocked LLM).

## Banner ads

The home page opens with a slider. Slide one is Parakh's own search; then come **Sponsored** banners (paid, always labelled), **Featured** picks, and when no ads are booked, the biggest real offers labelled "Offer running now". The last slide advertises the slot to restaurants. Banners are managed with the admin key:

```bash
curl -X POST localhost:8000/api/admin/banners -H "X-Admin-Key: $SECRET_KEY" -H 'content-type: application/json' \
  -d '{"store_slug":"tooso","kind":"sponsored","title":"BBQ night at Tooso","subtitle":"20% off delivery","priority":5,"ends_at":"2026-12-31T23:59:00Z"}'
```

Expired or inactive banners disappear automatically; clicks are counted (`POST /api/banners/{id}/click`).

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/products` | Dishes with filters: `category` (dish), `protein`, `city`, `store[]` (restaurant), `min_price`, `max_price`, `on_sale`, `sort`, `page` |
| GET | `/api/products/search?q=` | Natural-language search ("mutton karahi half under 3k", "burger deals") |
| GET | `/api/products/{id}` | Dish detail with portion, unit price and price history |
| POST | `/api/compare` | `{product_id}` → same dish elsewhere · `{product_ids:[…]}` → side-by-side table |
| GET | `/api/restaurants` · `/api/restaurants/{slug}` | Restaurants with menu stats, offers and ratings · full menu by section with reviews |
| GET | `/api/offers` | Restaurant-wide offers, combo deals by value, discounted dishes |
| GET | `/api/reviews` | Latest reviews (`restaurant`, `product_id`, `with_media=true` for the photo/video wall) |
| POST | `/api/restaurants/{slug}/reviews` | Multipart review: `rating`, `text`, `product_id`, `visited_branch`, `files[]` |
| GET | `/api/banners` | Active home-page banners, sponsored first |
| POST/PUT | `/api/admin/banners` | Create/update banners (`X-Admin-Key`) |
| GET | `/api/deals` · `/api/price-drops` | Discounted dishes · menu price drops |
| POST | `/api/chat` | Assistant |
| … | `/api/auth/*`, `/api/wishlist`, `/api/notifications` | Accounts, saved dishes, alerts |

## Frontend (Angular 22 + Tailwind 4)

Palette: **sage green** (headlines, primary actions, ink hero), **concrete grey** (page ground, slabs) and **burnt amber** (offers, stickers, accents), as mesh + luminous gradients. Fonts and motion carried over (Archivo, Atkinson Hyperlegible Next, IBM Plex Mono; scroll-driven reveals, odometer prices, spring stickers, reduced-motion support).

| Page | What it does |
| --- | --- |
| Home | Banner slider with ad slots, dish strip, live "one dish, every restaurant" receipt, restaurants, offers and combo deals, photo/video review wall, how comparison works, banner info for restaurants |
| Dishes `/dishes` | Dish, protein, city, restaurant and price filters; dish cards show portion and price per piece |
| Dish `/dishes/:id` | Same dish at other restaurants (cheapest first), similar dishes, price history, reviews of this dish with upload |
| Restaurants `/restaurants` | Cards with cuisines, cities, Google rating, offers, price range; city and cuisine filters |
| Restaurant `/restaurants/:slug` | Full menu by section, offers, Google + Parakh ratings, reviews with photos/videos and a review form |
| Deals `/deals` | Restaurant offers, combo deals, dishes on offer, price drops |
| Compare `/compare` | Side-by-side dishes with best figures marked |
| Assistant, Account | Food assistant; saved dishes and alerts |

## Deployment

- **Full stack**: `docker-compose.yml` or Render (`render.yaml`); Postgres (Supabase), Redis (Upstash).
- **Vercel demo** (`vercel.json`, `api/index.py`): serves a snapshot of the scraped menus (`deploy/vercel/build_snapshot.py`) from SQLite in `/tmp`. Accounts, reviews and uploads work per serverless instance but are not permanent there, and scraping does not run on Vercel. Use the Docker deployment for a persistent site.

## Notes and limits

- Prices come from each restaurant's own ordering site and can differ by branch; the UI says so and links to the restaurant to order.
- Google ratings and reviews appear only with a configured Places API key (billable on Google Cloud) and are always attributed to Google.
- Menu price drops build up over time; a fresh install shows them after the second read of a menu.
