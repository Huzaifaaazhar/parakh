# Parakh — compare products and sales across Pakistani stores

**Parakh** (پرکھ, "to assess") is a search, comparison and sale-tracking engine for Pakistani online stores. It covers fashion, footwear, electronics, beauty and home goods. Background scrapers collect products from the stores and normalize them into one catalogue. You can then:

- **Search** in plain language: "black kurta for men under 5000", "earbuds on sale", "laptops around 150k".
- **Compare** a product with the same item at other stores and with similar items from other brands, including the price difference.
- **Compare up to 4 products side by side**, from any stores and categories.
- **See every sale in one place**: which stores have sales, how deep the discounts are, and what just dropped in price.
- **Ask an AI assistant** (a LangGraph multi-agent system) that uses all of the above. It works without an LLM too.
- **Save items and get price-drop alerts** (accounts, wishlist, notifications).

```
                 ┌──────────── Celery beat (every 6h) ────────────┐
                 ▼                                                │
  Stores ──► Scrapers (Scrapling) ──► Normalizer ──► Ingestion ──► PostgreSQL
  (Shopify / HTML)                     taxonomy      change detection   │  products, price_history,
                                                     (new / drop / OOS) │  product_events, users…
                                                          │             │
                                            index changed products      │
                                                          ▼             │
                                   sentence-transformers ─► ChromaDB / LEANN
                                                          │             │
  Angular + Tailwind ──► FastAPI ──► services (search · compare · deals) ┘
                           │  ▲            ▲
                           ▼  │            │  Redis cache (generation-invalidated)
                        LangGraph agents ──┘
          router → search | comparison | deal finder → chat assistant (LLM or templates)
```

**Rule 1 holds:** user requests never trigger scraping. Requests only read PostgreSQL, the vector index and the Redis cache.

---

## Quick start (Docker)

```bash
cp .env.example .env            # works as-is; add GROQ_API_KEY / OPENROUTER_API_KEY for LLM answers
docker compose up --build -d    # db, redis, chroma, migrate, api, worker, beat, frontend

# Load data (pick one):
docker compose exec api python -m app.cli seed-demo     # ~225 realistic demo products, offline
docker compose exec api python -m app.cli scrape        # real stores (takes a while)
```

- App: http://localhost:8080
- API docs (Swagger): http://localhost:8000/docs

Once running, Celery beat re-scrapes every store every `SCRAPE_INTERVAL_HOURS` (default 6). It indexes changed products and sends price-drop notifications.

Build args: `INSTALL_ML=false` skips torch/sentence-transformers and uses the hashing embedder, which gives a much smaller image. `INSTALL_OPTIONAL=true` adds MemPalace and LEANN.

## Local development

Requirements: Python 3.12.10, Node 24 (Angular 22 needs Node ≥ 22.22.3), PostgreSQL 16 and Redis 7.

```bash
# Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt          # + requirements-ml.txt for local embeddings
cp ../.env.example ../.env
alembic upgrade head
python -m app.cli seed-demo                  # or: python -m app.cli scrape outfitters telemart --max-pages 2
uvicorn app.main:app --reload                # http://localhost:8000/docs

# Workers (separate terminals)
celery -A app.workers.celery_app worker -Q celery,scraping,indexing -l INFO
celery -A app.workers.celery_app beat -l INFO

# Frontend
cd frontend
npm install
npm start                                    # http://localhost:4200, proxies /api to :8000
```

### Tests

```bash
cd backend && pytest          # 91 tests: normalisation, query parsing, scrapers, ingestion, API, agents
cd frontend && npx ng build   # type-checks templates
```

The tests run fully offline. They use SQLite, the in-memory vector store, the hashing embedder, no LLM, and fake fetchers for the scrapers. The LLM path is tested with a mocked model.

---

## How it works

### 1. Scraping pipeline (`backend/app/scrapers`)

- **Fetch layer** (`fetch.py`): uses [Scrapling](https://github.com/Huzaifaaazhar/Scrapling). `Fetcher` makes fast HTTP requests with browser TLS fingerprints. `StealthyFetcher` and `DynamicFetcher` (Playwright) handle protected or JavaScript-heavy sites. It has retries with exponential backoff (so it handles HTTP 429), polite throttling, and an httpx fallback. The fetcher can be set per store.
- **Shopify adapter**: most Pakistani brands run Shopify. Their public `/products.json` returns 250 products per page with full details (variants, compare-at prices, stock, images), so one request covers both listing and detail pages.
- **HTML adapter**: a config-driven adapter for other sites. You give it Scrapling CSS selectors in `stores.yaml`, with optional detail-page enrichment.
- **Stores** (`stores.yaml`): 25 stores. Outfitters, Breakout, Gul Ahmed, J., Beechtree, Alkaram, Nishat, Engine, Servis, Ndure, Stylo, Borjan, Telemart, Vmart, Audionic, Ronin, Saeed Ghani and more. Adding a Shopify store takes one line.
- **Data-quality guards** (each one came from real scraping):
  - Only a scrape that covered the whole catalogue can mark items as removed or out of stock. A page-limited or failed run can't wipe a store.
  - Some stores report every variant as unavailable to "bot-like" clients. A large page with nothing in stock is treated as "stock unknown", not "sold out".
  - Shopify `vendor` values like "Men", "Bags" or `WN_26` are ignored as brand names.

### 2. Normalization (`services/normalization`)

Every product is mapped to one shared taxonomy: **vertical → category** (`fashion/kurta`, `electronics/earbuds`, `beauty/fragrance`, …). Categories are matched only within the verticals the store sells, so a care note saying "iron" can't turn a kurta into an appliance. The normalizer also extracts:

- gender (kids are checked first)
- colour and fabric (lawn, khaddar, cambric…)
- electronics specs (RAM, storage, mAh, screen size)
- clean titles with SKU codes stripped
- correct discount percentages

### 3. Change detection (`services/ingestion.py`)

Each run upserts products and appends `price_history` rows. It emits `product_events` for `new_item`, `price_drop` (≥ 1%, to ignore jitter), `price_increase`, `out_of_stock` and `back_in_stock`. These events drive `/price-drops`, the sales hub and wishlist alerts. Ingestion bumps a cache generation counter, which invalidates all cached reads in O(1).

### 4. Search and vectors

- `/products/search` parses the query into filters: PKR price expressions ("3k", "1 lac", "2-5k", "around 4000"), category synonyms and plurals, gender, colour, brand, and sale/cheapest/best-value intent.
- It then runs a hybrid search: SQL filters plus keyword matching plus semantic re-ranking.
- **Embeddings**: sentence-transformers `all-MiniLM-L6-v2` runs locally. A deterministic hashing embedder is the fallback, so the app works without torch.
- **Vector store**: ChromaDB (local folder or server). [LEANN](https://github.com/Huzaifaaazhar/LEANN) is an alternative (`VECTOR_BACKEND=leann`) that uses about 97% less storage and is rebuilt in batch. The in-memory store is for tests.

### 5. Comparison (`services/comparison_service.py`)

Not exact matching. The similarity score blends four signals:

- vector similarity
- attribute overlap (category, gender, colour, fabric, specs)
- title-token overlap
- price proximity

The same brand and model at a *different* store, in the same colour, is flagged as **same product**. For example, a Samsung phone at Telemart vs Vmart. Results include the price difference in Rs and %, the cheapest option, the best value, and a plain-language summary. `POST /compare` with `product_ids` returns a side-by-side table.

### 6. AI agents (`backend/app/agents`, LangGraph)

| Node | Role |
| --- | --- |
| `load_context` | Loads short-term memory (last N turns from Postgres) plus optional long-term recall from MemPalace |
| `understand` (router) | Rules extract intent and filters. If an LLM is configured, a fast model refines them as JSON, and the output is checked against the taxonomy. Follow-ups ("show cheaper ones") inherit the previous turn's filters. |
| **Search agent** | Turns the request into filters and queries the DB and vector index. Relaxes the free text if nothing matches. |
| **Comparison agent** | Resolves "this" (page context, a product named in the message, or the last product shown), then finds alternatives |
| **Deal finder agent** | Best discounts, recent price drops, or the store-by-store sales overview |
| **Chat assistant** | Writes the reply. The LLM is grounded only in the retrieved products; without an LLM, templated answers are used. |
| `save_context` | Saves the turn, with filters and product ids, for follow-ups |

**LLM strategy (free-first, swappable).** `LLM_PROVIDER=groq|openrouter|ollama|auto|none`. All three speak the OpenAI chat API, so switching is an env change. `LLM_FALLBACK_PROVIDERS` sets a fallback chain, and failed providers cool down for 60s. Cheap tasks (intent extraction) go to a smaller model. For local models, [llmfit](https://github.com/Huzaifaaazhar/llmfit) can pick one: run `llmfit serve` and set `LLMFIT_URL`, and the router asks `/api/v1/models/top` for the best model that fits the machine. With `none`, or if every provider fails, the agents use rules, so the assistant always answers.

### 7. Memory

- **Runtime memory**: per-session chat history in Postgres. Optionally [MemPalace](https://github.com/Huzaifaaazhar/mempalace) (`MEMORY_BACKEND=mempalace`) stores each exchange verbatim in a local palace, with one *wing* per user or session and *rooms* per intent, and recalls relevant past preferences into the assistant's prompt.
- **Development memory**: [claude-mem](https://github.com/Huzaifaaazhar/claude-mem) is a Claude Code plugin, not a runtime library. Install it in your editor (`npx claude-mem install`) so AI-assisted work on this repo keeps context across sessions. The app doesn't depend on it.

---

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/products` | Browse with filters: `vertical, category, gender, brand[], store[], color, fabric, min_price, max_price, on_sale, min_discount, sort, page, page_size` |
| GET | `/api/products/search?q=` | Natural-language plus semantic search; returns `parsed_filters` |
| GET | `/api/products/{id}` | Detail, with price history and lowest/highest price |
| GET | `/api/products/{id}/alternatives` | Similar or cheaper items across stores |
| GET | `/api/products/facets` | Filter options with counts |
| GET | `/api/products/trending` | Best-value picks |
| POST | `/api/compare` | `{product_id}` → alternatives · `{product_ids:[…]}` → side-by-side table |
| GET | `/api/deals` | Everything on sale (`sort=discount\|savings\|price_asc\|newest`) |
| GET | `/api/price-drops` | Recent drops that still hold |
| GET | `/api/sales` | Sales overview: totals, per-store sale stats, top deals, drops |
| GET | `/api/stores` | Per-store sale summary |
| POST | `/api/chat` | `{message, session_id?, product_id?}` → answer, products, comparison, suggestions, agent trace |
| POST | `/api/auth/register` · `/api/auth/login` | JWT auth |
| GET/POST/DELETE | `/api/wishlist` | Saved items with an optional target price |
| GET | `/api/notifications` | Price-drop and back-in-stock alerts |
| POST | `/api/admin/scrape` | Queue a background scrape (header `X-Admin-Key: $SECRET_KEY`) |

## Frontend (Angular 22 + Tailwind 4)

Standalone components, signals, OnPush everywhere, lazy-loaded routes, and URL-driven filters so every view can be shared. About 99 kB gzipped on first load.

| Page | What it does |
| --- | --- |
| Home | Search, example queries, departments, live store-sale strip, best-value picks, price drops |
| Browse `/products` | Filters (department, category, gender, price, stores, on sale), sort, pagination, "We understood: …" chips for parsed queries |
| Product `/products/:id` | Price-history chart, specs, store link, save and alert, "Compare alternatives" with same-product badges and Rs/% differences |
| Compare `/compare` | Floating compare tray (any 2–4 products) → side-by-side table with the best values highlighted |
| Sales `/sales` | Every sale in one place: store cards (share of catalogue on sale, max and average discount), top deals, price drops |
| Assistant `/assistant` | Chat UI with product carousels, suggestion chips, and a "How I answered" agent trace. Opening it from a product page passes that product as context. |
| Account `/account` | Sign in or register, saved items, price alerts |

## Deployment (free-first)

- **Database**: Supabase Postgres. Set `DATABASE_URL=postgresql+psycopg://…supabase…`, then run `alembic upgrade head`.
- **Redis**: Upstash or Render Key Value (`REDIS_URL`).
- **Backend**: Render, using the `render.yaml` blueprint (API plus a Celery worker with embedded beat), or Railway with the same Dockerfile. The free tier's disk is ephemeral, so either point `CHROMA_HOST` at a hosted Chroma or let the nightly reindex rebuild the local index.
- **Frontend**: Vercel. `frontend/vercel.json` builds the app and rewrites `/api/*` to your backend URL (replace `YOUR-BACKEND`). Netlify works the same way with a `_redirects` proxy rule.

## Project layout

```
backend/
  app/
    api/routes/      products, compare, deals, chat, users (auth/wishlist/notifications), system
    agents/          LangGraph state, intent router, agent nodes, graph
    core/            config (.env), logging, Redis cache, security, error handlers
    db/              engine/session, base types, demo seed
    models/          SQLAlchemy models
    schemas/         Pydantic schemas
    scrapers/        Scrapling fetch layer, Shopify + HTML adapters, stores.yaml
    services/        normalization, ingestion, indexing, search, comparison, deals, llm, memory, vector
    workers/         Celery app + tasks (scrape, index, alerts)
    cli.py           init-db | seed-demo | scrape | reindex | alerts
  alembic/           migrations
  tests/
frontend/src/app/    core (api, auth, compare tray), shared (cards, chart, pipes), pages
docker/              Dockerfiles + nginx config
docker-compose.yml
```

## Notes and limits

- Scraping relies on each store's public storefront data. Respect their terms and keep `SCRAPER_REQUEST_DELAY` polite. Prices shown are from the last scrape, and the UI says so.
- The demo seed has no product images; the UI shows category-tinted placeholders. Real scrapes include store images.
- Price history and drops build up over time. A fresh install shows drops only after the second scrape of a store.
