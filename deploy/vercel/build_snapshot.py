"""Build the read-mostly data snapshot used by the Vercel demo deployment.

Copies the catalogue (stores, products, price history, events, scrape runs)
from a live database into a gzipped SQLite file, and precomputes the
hashing-embedder vectors so the serverless function doesn't re-embed on
every cold start. User data (accounts, chats) is never included.

    cd backend
    DATABASE_URL=postgresql+psycopg://... python ../deploy/vercel/build_snapshot.py
"""

import gzip
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "backend"))
os.environ["EMBEDDING_BACKEND"] = "hash"
os.environ["VECTOR_BACKEND"] = "memory"

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.models import PriceHistory, Product, ProductEvent, ScrapeRun, Store  # noqa: E402
from app.services.indexing import index_products  # noqa: E402
from app.services.vector.store import get_vector_store  # noqa: E402

CATALOGUE = [Store, Product, PriceHistory, ProductEvent, ScrapeRun]


def main() -> None:
    source = create_engine(os.environ["DATABASE_URL"])
    tmp = Path(tempfile.mkdtemp()) / "parakh.db"
    target = create_engine(f"sqlite:///{tmp}")
    Base.metadata.create_all(target)

    with source.connect() as src, target.begin() as dst:
        for model in CATALOGUE:
            table = model.__table__
            rows = [dict(r._mapping) for r in src.execute(select(table))]
            if rows:
                dst.execute(table.insert(), rows)
            print(f"{table.name}: {len(rows)}")

    with Session(target) as db:
        index_products(db, None)
    get_vector_store().save(str(HERE / "vectors.npz"))

    with open(tmp, "rb") as f_in, gzip.open(HERE / "snapshot.db.gz", "wb", compresslevel=9) as f_out:
        shutil.copyfileobj(f_in, f_out)
    for name in ("snapshot.db.gz", "vectors.npz"):
        print(name, round((HERE / name).stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
