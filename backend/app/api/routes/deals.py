from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.routes.products import product_query
from app.db.session import get_db
from app.schemas.deals import DealsResponse, PriceDrop, SalesOverview
from app.schemas.product import ProductQuery, StoreSaleSummary
from app.services import deal_service

router = APIRouter(tags=["deals"])


@router.get("/deals", response_model=DealsResponse, summary="Everything on sale, biggest discounts first")
def deals(
    query: ProductQuery = Depends(product_query),
    sort: Annotated[str, Query(pattern="^(discount|savings|price_asc|price_desc|newest)$")] = "discount",
    db: Session = Depends(get_db),
):
    return deal_service.get_deals(db, query={**query.model_dump(exclude={"q"}), "sort": sort})


@router.get("/price-drops", response_model=list[PriceDrop], summary="Products whose price recently dropped")
def price_drops(
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    vertical: str | None = None,
    min_drop: Annotated[float, Query(ge=0, le=100)] = 1.0,
    db: Session = Depends(get_db),
):
    return deal_service.get_price_drops(db, days=days, limit=limit, vertical=vertical, min_drop=min_drop)


@router.get("/sales", response_model=SalesOverview, summary="Sale aggregation across all stores")
def sales(vertical: str | None = None, db: Session = Depends(get_db)):
    return deal_service.sales_overview(db, vertical=vertical)


@router.get("/stores", response_model=list[StoreSaleSummary], tags=["stores"])
def stores(vertical: str | None = None, db: Session = Depends(get_db)):
    return deal_service.store_sale_summaries(db, vertical=vertical)
