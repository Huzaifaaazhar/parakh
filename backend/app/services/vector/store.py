"""Vector store abstraction for products.

Backends:
- chroma (default): ChromaDB, local persistent dir or a Chroma server.
- leann: LEANN (https://github.com/Huzaifaaazhar/LEANN) graph index with
  ~97% less storage; rebuilt in batch by the indexing task.
- memory: numpy in-process index, used in tests.

Metadata stored alongside each vector (vertical, category, gender, brand,
price, store_id) enables filtered similarity search.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.services.vector.embeddings import get_embedder

log = get_logger(__name__)

COLLECTION = "products"


@dataclass
class VectorHit:
    product_id: int
    score: float  # cosine similarity, higher is better
    metadata: dict[str, Any]


def _matches(meta: dict[str, Any], where: dict[str, Any] | None) -> bool:
    if not where:
        return True
    for key, cond in where.items():
        value = meta.get(key)
        if isinstance(cond, dict):
            for op, target in cond.items():
                if op == "$ne" and value == target:
                    return False
                if op == "$in" and value not in target:
                    return False
                if op == "$nin" and value in target:
                    return False
                if op == "$lte" and (value is None or value > target):
                    return False
                if op == "$gte" and (value is None or value < target):
                    return False
        elif value != cond:
            return False
    return True


class VectorStore(ABC):
    def __init__(self):
        self.embedder = get_embedder()

    @abstractmethod
    def upsert(self, ids: list[int], texts: list[str], metadatas: list[dict[str, Any]]) -> None: ...

    @abstractmethod
    def query(self, text: str, k: int = 20, where: dict[str, Any] | None = None) -> list[VectorHit]: ...

    @abstractmethod
    def delete(self, ids: list[int]) -> None: ...

    @abstractmethod
    def count(self) -> int: ...

    def query_by_id(self, product_id: int, text: str, k: int = 20, where: dict[str, Any] | None = None) -> list[VectorHit]:
        return [h for h in self.query(text, k + 1, where) if h.product_id != product_id][:k]


class MemoryVectorStore(VectorStore):
    """In-process index: a numpy matrix of unit vectors. Used in tests and serverless demos,
    where it can be loaded from a precomputed `.npz` snapshot instead of re-embedding."""

    def __init__(self):
        super().__init__()
        self._vectors: dict[int, list[float]] = {}
        self._meta: dict[int, dict[str, Any]] = {}
        self._matrix = None  # rebuilt lazily after writes
        self._ids: list[int] = []

    def upsert(self, ids, texts, metadatas):
        for pid, vec, meta in zip(ids, self.embedder.embed(texts), metadatas, strict=True):
            self._vectors[pid] = vec
            self._meta[pid] = meta
        self._matrix = None

    def _ensure_matrix(self):
        import numpy as np

        if self._matrix is None:
            self._ids = list(self._vectors)
            self._matrix = np.array([self._vectors[i] for i in self._ids], dtype=np.float32)
        return self._matrix

    def query(self, text, k=20, where=None):
        import numpy as np

        if not self._vectors:
            return []
        scores = self._ensure_matrix() @ np.array(self.embedder.embed([text])[0], dtype=np.float32)
        hits = []
        for idx in np.argsort(-scores):
            pid = self._ids[idx]
            if _matches(self._meta[pid], where):
                hits.append(VectorHit(pid, float(scores[idx]), self._meta[pid]))
                if len(hits) >= k:
                    break
        return hits

    def delete(self, ids):
        for pid in ids:
            self._vectors.pop(pid, None)
            self._meta.pop(pid, None)
        self._matrix = None

    def count(self):
        return len(self._vectors)

    def save(self, path: str) -> None:
        import json

        import numpy as np

        matrix = self._ensure_matrix()
        meta = json.dumps([self._meta[i] for i in self._ids])
        np.savez_compressed(path, ids=np.array(self._ids, dtype=np.int64), vectors=matrix.astype(np.float16), meta=np.array(meta))

    def load(self, path: str) -> None:
        import json

        import numpy as np

        data = np.load(path)
        self._ids = [int(i) for i in data["ids"]]
        self._matrix = data["vectors"].astype(np.float32)
        metas = json.loads(str(data["meta"]))
        self._vectors = {pid: self._matrix[i] for i, pid in enumerate(self._ids)}
        self._meta = dict(zip(self._ids, metas, strict=True))


class ChromaVectorStore(VectorStore):
    def __init__(self):
        super().__init__()
        import chromadb

        if settings.chroma_host:
            self._client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
        else:
            Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=settings.chroma_path)
        self._col = self._client.get_or_create_collection(
            f"{COLLECTION}_{self.embedder.name.split('/')[-1].replace('.', '-')}"[:60],
            metadata={"hnsw:space": "cosine"},
        )

    @staticmethod
    def _where(where: dict[str, Any] | None) -> dict[str, Any] | None:
        if not where:
            return None
        clauses = []
        for key, cond in where.items():
            if isinstance(cond, dict):
                clauses.extend({key: {op: v}} for op, v in cond.items())
            else:
                clauses.append({key: cond})
        return clauses[0] if len(clauses) == 1 else {"$and": clauses}

    def upsert(self, ids, texts, metadatas):
        if not ids:
            return
        clean = [{k: v for k, v in m.items() if v is not None} for m in metadatas]
        self._col.upsert(ids=[str(i) for i in ids], embeddings=self.embedder.embed(texts), metadatas=clean, documents=texts)

    def query(self, text, k=20, where=None):
        if self.count() == 0:
            return []
        res = self._col.query(
            query_embeddings=self.embedder.embed([text]),
            n_results=k,
            where=self._where(where),
            include=["metadatas", "distances"],
        )
        ids, dists, metas = res["ids"][0], res["distances"][0], res["metadatas"][0]
        return [VectorHit(int(i), 1.0 - float(d), m or {}) for i, d, m in zip(ids, dists, metas, strict=True)]

    def delete(self, ids):
        if ids:
            self._col.delete(ids=[str(i) for i in ids])

    def count(self):
        return self._col.count()


class LeannVectorStore(VectorStore):
    """LEANN keeps a compact graph index and recomputes embeddings at query time.

    LEANN indexes are built in one shot, so upserts are buffered and the
    index is rebuilt by `rebuild()` (called from the Celery indexing task).
    Queries are served by the last built index.
    """

    def __init__(self):
        super().__init__()
        from leann import LeannSearcher  # noqa: F401 - fail fast if not installed

        self._path = settings.leann_index_path
        self._pending: dict[int, tuple[str, dict[str, Any]]] = {}
        self._searcher = None

    def _get_searcher(self):
        if self._searcher is None and (Path(f"{self._path}.meta.json").exists() or Path(self._path).exists()):
            from leann import LeannSearcher

            self._searcher = LeannSearcher(self._path)
        return self._searcher

    def upsert(self, ids, texts, metadatas):
        for pid, text, meta in zip(ids, texts, metadatas, strict=True):
            self._pending[pid] = (text, {**meta, "product_id": pid})

    def rebuild(self, items: list[tuple[int, str, dict[str, Any]]]) -> None:
        from leann import LeannBuilder

        Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        builder = LeannBuilder(backend_name="hnsw")
        for pid, text, meta in items:
            builder.add_text(text, metadata={**{k: v for k, v in meta.items() if v is not None}, "product_id": pid})
        builder.build_index(self._path)
        self._searcher = None
        self._pending.clear()

    def query(self, text, k=20, where=None):
        searcher = self._get_searcher()
        if searcher is None:
            return []
        filters = None
        if where:
            filters = {}
            for key, cond in where.items():
                if isinstance(cond, dict):
                    ops = {"$lte": "<=", "$gte": ">=", "$ne": "!=", "$in": "in", "$nin": "not_in"}
                    filters[key] = {ops[o]: v for o, v in cond.items() if o in ops}
                else:
                    filters[key] = {"==": cond}
        results = searcher.search(text, top_k=k, metadata_filters=filters) if filters else searcher.search(text, top_k=k)
        hits = []
        for r in results:
            meta = getattr(r, "metadata", None) or {}
            pid = meta.get("product_id")
            if pid is not None:
                hits.append(VectorHit(int(pid), float(getattr(r, "score", 0.0)), meta))
        return hits

    def delete(self, ids):
        for pid in ids:
            self._pending.pop(pid, None)

    def count(self):
        return len(self._pending)


@lru_cache
def get_vector_store() -> VectorStore:
    backend = settings.vector_backend
    try:
        if backend == "leann":
            return LeannVectorStore()
        if backend == "chroma":
            return ChromaVectorStore()
    except Exception as exc:  # noqa: BLE001
        log.warning("Vector backend '%s' unavailable (%s); using in-memory index", backend, exc)
    return MemoryVectorStore()


def product_metadata(p: Any) -> dict[str, Any]:
    return {
        "vertical": p.vertical,
        "category": p.category,
        "gender": p.gender or "none",
        "brand": p.brand_name,
        "store_id": p.store_id,
        "price": float(p.price),
        "in_stock": bool(p.in_stock),
    }
