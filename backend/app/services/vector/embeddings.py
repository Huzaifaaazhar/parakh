"""Embedding models.

Default: a local sentence-transformers model (all-MiniLM-L6-v2, 384 dims).
Fallback: a deterministic hashing embedder (character n-grams + words) so
the app and tests run without downloading a model or installing torch.
"""

import hashlib
import math
import re
import threading
from functools import lru_cache

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


class HashingEmbedder:
    name = "hash-384"

    def __init__(self, dim: int = 384):
        self.dim = dim

    def _features(self, text: str) -> list[str]:
        words = _TOKEN_RE.findall(text.lower())
        feats = [f"w:{w}" for w in words]
        feats += [f"b:{a}_{b}" for a, b in zip(words, words[1:], strict=False)]
        for w in words:
            padded = f"#{w}#"
            feats += [f"c:{padded[i : i + 3]}" for i in range(max(1, len(padded) - 2))]
        return feats

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * self.dim
            for feat in self._features(text):
                h = int.from_bytes(hashlib.blake2b(feat.encode(), digest_size=8).digest(), "little")
                weight = 2.0 if feat.startswith("w:") else 1.0
                vec[h % self.dim] += weight if (h >> 63) & 1 else -weight
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self.name = model_name
        self._model = SentenceTransformer(model_name)
        self._lock = threading.Lock()

    def embed(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            vectors = self._model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
        return [v.tolist() for v in vectors]


@lru_cache
def get_embedder():
    if settings.embedding_backend == "sentence-transformers":
        try:
            embedder = SentenceTransformerEmbedder(settings.embedding_model)
            log.info("Loaded embedding model %s", settings.embedding_model)
            return embedder
        except Exception as exc:  # noqa: BLE001 - ImportError or model download failure
            log.warning("sentence-transformers unavailable (%s); using hashing embedder", exc)
    return HashingEmbedder()
