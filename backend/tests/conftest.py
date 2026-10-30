import os
import tempfile

# Configure an isolated, offline environment *before* the app is imported.
_tmp = tempfile.mkdtemp(prefix="parakh-test-")
os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{_tmp}/test.db",
        "REDIS_URL": "redis://127.0.0.1:1/0",  # unreachable -> in-memory cache
        "CACHE_ENABLED": "false",
        "EMBEDDING_BACKEND": "hash",
        "VECTOR_BACKEND": "memory",
        "LLM_PROVIDER": "none",
        "MEMORY_BACKEND": "db",
        "SECRET_KEY": "test-secret",
        "LOG_LEVEL": "WARNING",
        "SCRAPER_REQUEST_DELAY": "0",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.seed import seed_demo  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def demo_data():
    seed_demo()
    yield


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture
def product_id(client):
    def find(q: str) -> int:
        items = client.get("/api/products/search", params={"q": q}).json()["items"]
        assert items, f"no product for {q!r}"
        return items[0]["id"]

    return find
