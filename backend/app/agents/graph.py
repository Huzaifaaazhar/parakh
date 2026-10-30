r"""LangGraph orchestration.

    START -> load_context -> understand --(route)--> search_agent ----\
                                              |--> comparison_agent --> chat_assistant -> save_context -> END
                                              |--> deal_agent -------/
                                              \--> chat_assistant (greetings)
"""

import uuid
from functools import lru_cache
from typing import Any

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from app.agents import nodes
from app.agents.state import AgentState


@lru_cache
def build_graph():
    g = StateGraph(AgentState)
    g.add_node("load_context", nodes.load_context)
    g.add_node("understand", nodes.understand)
    g.add_node("search_agent", nodes.search_agent)
    g.add_node("comparison_agent", nodes.comparison_agent)
    g.add_node("deal_agent", nodes.deal_agent)
    g.add_node("chat_assistant", nodes.chat_assistant)
    g.add_node("save_context", nodes.save_context)

    g.add_edge(START, "load_context")
    g.add_edge("load_context", "understand")
    g.add_conditional_edges(
        "understand",
        nodes.route,
        {
            "search_agent": "search_agent",
            "comparison_agent": "comparison_agent",
            "deal_agent": "deal_agent",
            "chat_assistant": "chat_assistant",
        },
    )
    for agent in ("search_agent", "comparison_agent", "deal_agent"):
        g.add_edge(agent, "chat_assistant")
    g.add_edge("chat_assistant", "save_context")
    g.add_edge("save_context", END)
    return g.compile()


def run_chat(
    db: Session, message: str, session_id: str | None = None, product_id: int | None = None, user_id: int | None = None
) -> dict[str, Any]:
    session_id = session_id or uuid.uuid4().hex
    state: AgentState = {"message": message, "session_id": session_id, "product_id": product_id, "user_id": user_id, "trace": []}
    result = build_graph().invoke(state, config={"configurable": {"db": db}})
    return {
        "session_id": session_id,
        "answer": result.get("answer", ""),
        "intent": result.get("intent", "search"),
        "filters": result.get("filters") or {},
        "products": result.get("products") or [],
        "comparison": result.get("comparison"),
        "suggestions": result.get("suggestions") or [],
        "used_llm": bool(result.get("used_llm")),
        "agent_trace": result.get("trace") or [],
    }
