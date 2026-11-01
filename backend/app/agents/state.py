import operator
from typing import Annotated, Any, TypedDict


class AgentState(TypedDict, total=False):
    # input
    message: str
    session_id: str
    user_id: int | None
    product_id: int | None
    # memory
    history: list[dict[str, Any]]
    recalled: list[str]
    # understanding
    intent: str  # search | compare | deals | price_drops | sales_overview | greeting
    filters: dict[str, Any]
    cheaper_only: bool
    # agent outputs
    products: list[dict[str, Any]]
    comparison: dict[str, Any] | None
    overview: dict[str, Any] | None
    offers: dict[str, Any] | None  # restaurant-wide offers + combo deals (sales_overview)
    answer: str
    suggestions: list[str]
    used_llm: bool
    trace: Annotated[list[str], operator.add]
