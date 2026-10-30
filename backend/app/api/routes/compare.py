from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.compare import CompareRequest, CompareResponse, SideBySideResponse
from app.services import comparison_service

router = APIRouter(tags=["comparison"])


@router.post(
    "/compare",
    response_model=CompareResponse | SideBySideResponse,
    summary="Find similar/cheaper items across stores (product_id) or compare several products side by side (product_ids)",
)
def compare(body: CompareRequest, db: Session = Depends(get_db)):
    if body.product_ids and len(body.product_ids) >= 2:
        return comparison_service.side_by_side(db, body.product_ids)
    pid = body.product_id or body.product_ids[0]
    return comparison_service.find_alternatives(
        db, product_id=pid, limit=body.limit, cheaper_only=body.cheaper_only, other_brands_only=body.other_brands_only
    )


@router.get("/products/{product_id}/alternatives", response_model=CompareResponse, tags=["products"])
def alternatives(product_id: int, limit: int = 12, cheaper_only: bool = False, db: Session = Depends(get_db)):
    return comparison_service.find_alternatives(
        db, product_id=product_id, limit=min(limit, 50), cheaper_only=cheaper_only, other_brands_only=True
    )
