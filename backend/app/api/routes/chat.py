from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.agents.graph import run_chat
from app.api.deps import get_optional_user
from app.db.session import get_db
from app.models import User
from app.schemas.chat import ChatRequest, ChatResponse

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, summary="AI shopping assistant (LangGraph multi-agent)")
def chat(body: ChatRequest, db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    return run_chat(db, body.message, session_id=body.session_id, product_id=body.product_id, user_id=user.id if user else None)
