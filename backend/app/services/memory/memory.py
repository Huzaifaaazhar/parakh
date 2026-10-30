"""Conversation memory for the shopping assistant.

Short-term: the last N turns of a session from Postgres (chat_messages).
Long-term (optional, MEMORY_BACKEND=mempalace): MemPalace
(https://github.com/Huzaifaaazhar/mempalace) stores every exchange verbatim in
a local ChromaDB "palace" — one wing per session/user, rooms per intent — and
recalls relevant past preferences ("I usually wear medium", "I like Khaadi").
"""

import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models import ChatMessage

log = get_logger(__name__)


class MemPalaceMemory:
    def __init__(self, palace_path: str):
        os.environ.setdefault("MEMPALACE_PALACE_PATH", palace_path)
        os.makedirs(palace_path, exist_ok=True)
        from mempalace.mcp_server.tools_write import tool_add_drawer  # noqa: F401
        from mempalace.searcher import search_memories  # noqa: F401

        self.palace_path = palace_path

    @staticmethod
    def _wing(session_id: str, user_id: int | None) -> str:
        return f"user_{user_id}" if user_id else f"session_{session_id[:24]}"

    def remember(self, session_id: str, user_id: int | None, room: str, content: str) -> None:
        from mempalace.mcp_server.tools_write import tool_add_drawer

        result = tool_add_drawer(wing=self._wing(session_id, user_id), room=room or "general", content=content, added_by="parakh")
        if isinstance(result, dict) and not result.get("success", True):
            log.debug("MemPalace add_drawer: %s", result.get("error"))

    def recall(self, session_id: str, user_id: int | None, query: str, n: int = 3) -> list[str]:
        from mempalace.searcher import search_memories

        result = search_memories(query, palace_path=self.palace_path, wing=self._wing(session_id, user_id), n_results=n)
        return [hit.get("text", "") for hit in result.get("results", []) if hit.get("text")]


class ChatMemory:
    def __init__(self) -> None:
        self.long_term: MemPalaceMemory | None = None
        if settings.memory_backend == "mempalace":
            try:
                self.long_term = MemPalaceMemory(settings.mempalace_palace_path)
                log.info("Long-term memory: MemPalace at %s", settings.mempalace_palace_path)
            except Exception as exc:  # noqa: BLE001
                log.warning("MemPalace unavailable (%s); using database memory only", exc)

    def history(self, db: Session, session_id: str, turns: int | None = None) -> list[dict[str, Any]]:
        limit = (turns or settings.memory_history_turns) * 2
        rows = db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(limit)
        ).all()
        return [{"role": r.role, "content": r.content, "meta": r.meta or {}} for r in reversed(rows)]

    def recall(self, session_id: str, user_id: int | None, query: str) -> list[str]:
        if not self.long_term:
            return []
        try:
            return self.long_term.recall(session_id, user_id, query)
        except Exception as exc:  # noqa: BLE001
            log.warning("MemPalace recall failed: %s", exc)
            return []

    def save(self, db: Session, session_id: str, user_id: int | None, user_msg: str, answer: str, meta: dict[str, Any]) -> None:
        db.add(ChatMessage(session_id=session_id, user_id=user_id, role="user", content=user_msg, meta={}))
        db.add(ChatMessage(session_id=session_id, user_id=user_id, role="assistant", content=answer, meta=meta))
        db.commit()
        if self.long_term:
            try:
                self.long_term.remember(session_id, user_id, meta.get("intent", "general"), f"User: {user_msg}\nAssistant: {answer}")
            except Exception as exc:  # noqa: BLE001
                log.warning("MemPalace save failed: %s", exc)


_memory: ChatMemory | None = None


def get_memory() -> ChatMemory:
    global _memory
    if _memory is None:
        _memory = ChatMemory()
    return _memory
