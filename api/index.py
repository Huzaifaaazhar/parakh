"""Vercel serverless entry point for the demo deployment.

Vercel can't run Postgres, Redis or Celery, so the demo serves a snapshot of
the scraped catalogue: on cold start the gzipped SQLite snapshot is copied to
/tmp (writable, so sign-up, wishlist and chat memory work per instance) and
the precomputed vectors are loaded into the in-memory index. Scheduled
scraping runs only in the full Docker/Render deployment.
"""

import gzip
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_DIR = ROOT / "deploy" / "vercel"
DB_PATH = "/tmp/parakh.db"

sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_PATH}")
os.environ.setdefault("VECTOR_BACKEND", "memory")
os.environ.setdefault("EMBEDDING_BACKEND", "hash")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:1/0")  # no Redis: in-process cache
os.environ.setdefault("MEMORY_BACKEND", "db")

if not os.path.exists(DB_PATH):
    with gzip.open(SNAPSHOT_DIR / "snapshot.db.gz", "rb") as src, open(DB_PATH, "wb") as dst:
        shutil.copyfileobj(src, dst)

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402,F401  (Vercel serves this ASGI app)
from app.services.vector.store import MemoryVectorStore, get_vector_store  # noqa: E402

Base.metadata.create_all(engine)  # user tables (empty in the snapshot)
_store = get_vector_store()
if isinstance(_store, MemoryVectorStore) and _store.count() == 0:
    _store.load(str(SNAPSHOT_DIR / "vectors.npz"))
