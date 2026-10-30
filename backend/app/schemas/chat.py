from typing import Any

from pydantic import BaseModel, Field

from app.schemas.product import ProductOut


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, max_length=64)
    product_id: int | None = None  # page context: "cheaper alternatives to this"


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    intent: str
    filters: dict[str, Any] = {}
    products: list[ProductOut] = []
    comparison: dict[str, Any] | None = None
    suggestions: list[str] = []
    used_llm: bool = False
    agent_trace: list[str] = []
