from datetime import datetime

from pydantic import BaseModel

from app.schemas.product import ProductOut, StoreSaleSummary


class PriceDrop(BaseModel):
    product: ProductOut
    old_price: float
    new_price: float
    drop_amount: float
    drop_percentage: float
    detected_at: datetime


class DealsResponse(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int


class SalesOverview(BaseModel):
    """Everything on sale, across every store, in one place."""

    total_products: int
    total_on_sale: int
    average_discount: float
    stores: list[StoreSaleSummary]
    by_vertical: dict[str, int]
    top_deals: list[ProductOut]
    recent_price_drops: list[PriceDrop]
