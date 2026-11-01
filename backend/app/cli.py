"""Operational commands.

python -m app.cli init-db            # create tables (dev; use `alembic upgrade head` in prod)
python -m app.cli seed-demo          # load realistic demo data (offline)
python -m app.cli scrape [slug ...]  # scrape now, inline (ops/backfill)
python -m app.cli reindex            # rebuild the vector index
python -m app.cli renormalize        # re-run dish detection on stored menus (after taxonomy changes)
python -m app.cli alerts             # generate price-drop notifications
python -m app.cli places-sync [slug ...]          # Google rating, address and reviews (needs GOOGLE_MAPS_API_KEY)
python -m app.cli places-discover --city Lahore   # find restaurants on Google, detect their ordering platform
python -m app.cli detect-platform site.pk ...     # which menu adapter a restaurant site can use
"""

import argparse
import sys

from app.core.logging import get_logger, setup_logging

setup_logging()
log = get_logger("cli")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="parakh")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    seed = sub.add_parser("seed-demo")
    seed.add_argument("--with-history", action="store_true", default=True)
    scrape = sub.add_parser("scrape")
    scrape.add_argument("stores", nargs="*")
    scrape.add_argument("--max-pages", type=int, default=None)
    sub.add_parser("reindex")
    sub.add_parser("renormalize")
    sub.add_parser("alerts")
    psync = sub.add_parser("places-sync")
    psync.add_argument("stores", nargs="*")
    pdisc = sub.add_parser("places-discover")
    pdisc.add_argument("--city", required=True)
    pdisc.add_argument("--query", action="append", help="repeatable; defaults to common cuisines")
    detect = sub.add_parser("detect-platform")
    detect.add_argument("sites", nargs="+")
    args = parser.parse_args(argv)

    if args.cmd == "init-db":
        import app.models  # noqa: F401
        from app.db.base import Base
        from app.db.session import engine

        Base.metadata.create_all(engine)
        log.info("Tables created")
    elif args.cmd == "seed-demo":
        from app.db.seed import seed_demo

        n = seed_demo()
        log.info("Seeded %d demo products", n)
    elif args.cmd == "scrape":
        from app.core.config import settings
        from app.db.session import session_scope
        from app.scrapers.registry import load_store_configs
        from app.services.indexing import index_products
        from app.workers.tasks import generate_price_alerts, run_store_scrape

        if args.max_pages:
            settings.scraper_max_pages = args.max_pages
        slugs = args.stores or [c.slug for c in load_store_configs()]
        changed: list[int] = []
        for slug in slugs:
            try:
                result = run_store_scrape(slug)
                changed += result["changed_ids"]
                log.info("%s: %s changed", slug, result["changed"])
            except Exception as exc:  # noqa: BLE001
                log.error("%s failed: %s", slug, exc)
        with session_scope() as db:
            index_products(db, changed)
        generate_price_alerts()
    elif args.cmd == "reindex":
        from app.db.session import session_scope
        from app.services.indexing import index_products

        with session_scope() as db:
            log.info("Indexed %d products", index_products(db, None))
    elif args.cmd == "renormalize":
        from app.db.session import session_scope
        from app.services.indexing import index_products
        from app.services.ingestion import renormalize_all

        with session_scope() as db:
            log.info("Re-categorised %d menu items", renormalize_all(db))
            index_products(db, None)
    elif args.cmd == "alerts":
        from app.workers.tasks import generate_price_alerts

        log.info("Created %d notifications", generate_price_alerts())
    elif args.cmd == "places-sync":
        from app.db.session import session_scope
        from app.services.places import sync_all

        with session_scope() as db:
            results = sync_all(db, args.stores or None)
        log.info("Google Places: %d matched, %d not found", sum(results.values()), len(results) - sum(results.values()))
    elif args.cmd == "places-discover":
        from app.scrapers.platform_detect import detect_platform
        from app.services.places import discover

        places = discover(args.city, args.query)
        print(f"# {len(places)} places on Google for {args.city}; ones with a supported menu platform are ready to add")
        for p in places:
            platform = detect_platform(p.website) if p.website else None
            mark = "" if platform in {"indolj", "jsonld"} else "# "
            print(
                f'{mark}- {{name: "{p.name}", website: "{p.website or ""}", platform: {platform or "unknown"}, cities: [{args.city}]}}'
                f"  # {p.rating or '-'} ({p.rating_count or 0} reviews)"
            )
    elif args.cmd == "detect-platform":
        from app.scrapers.platform_detect import detect_platform

        for site in args.sites:
            print(site, detect_platform(site) or "unknown")
    return 0


if __name__ == "__main__":
    sys.exit(main())
