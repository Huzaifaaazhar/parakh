from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.product import Facets, ProductDetail, ProductPage, ProductQuery, SearchResponse
from app.services import product_service

router = APIRouter(prefix="/products", tags=["products"])


def product_query(
    q: str | None = None,
    vertical: str | None = None,
    category: str | None = None,
    gender: str | None = None,
    brand: Annotated[list[str] | None, Query()] = None,
    store: Annotated[list[str] | None, Query()] = None,
    color: str | None = None,
    fabric: str | None = None,
    protein: str | None = None,
    city: str | None = None,
    min_price: Annotated[float | None, Query(ge=0)] = None,
    max_price: Annotated[float | None, Query(ge=0)] = None,
    on_sale: bool = False,
    in_stock: bool | None = True,
    min_discount: Annotated[float | None, Query(ge=0, le=100)] = None,
    sort: Annotated[str, Query(pattern="^(relevance|price_asc|price_desc|discount|newest|value)$")] = "relevance",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> ProductQuery:
    return ProductQuery(**{k: v for k, v in locals().items()})


@router.get("", response_model=ProductPage, summary="Browse dishes with filters")
def list_products(query: ProductQuery = Depends(product_query), db: Session = Depends(get_db)):
    return product_service.list_products(db, query=query.model_dump(exclude={"q"}))


@router.get("/search", response_model=SearchResponse, summary="Natural-language + semantic search")
def search(
    q: Annotated[str, Query(min_length=1, max_length=200, description="e.g. 'chicken tikka under 800' or 'large pizza deals'")],
    query: ProductQuery = Depends(product_query),
    db: Session = Depends(get_db),
):
    return product_service.search_products(db, query={**query.model_dump(), "q": q})


@router.get("/facets", response_model=Facets, summary="Filter options with counts")
def get_facets(vertical: str | None = None, db: Session = Depends(get_db)):
    return product_service.facets(db, vertical=vertical)


@router.get("/trending", response_model=ProductPage, summary="Newest and biggest-discount items")
def trending(vertical: str | None = None, limit: Annotated[int, Query(ge=1, le=48)] = 12, db: Session = Depends(get_db)):
    return product_service.list_products(db, query={"vertical": vertical, "sort": "value", "page_size": limit, "in_stock": True})


@router.get("/{product_id}", response_model=ProductDetail)
def get_product(product_id: int, db: Session = Depends(get_db)):
    return product_service.get_product_detail(db, product_id)
