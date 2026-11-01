from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class StoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    website: str
    platform: str
    verticals: list[str] = []
    logo_url: str | None = None
    last_scraped_at: datetime | None = None
    cuisines: list[str] = []
    cities: list[str] = []
    offers: list[dict[str, Any]] = []
    rating: float | None = None
    rating_count: int | None = None
    price_level: str | None = None
    address: str | None = None
    maps_url: str | None = None


class StoreSaleSummary(StoreOut):
    total_products: int = 0
    on_sale: int = 0
    sale_share: float = 0.0
    max_discount: float = 0.0
    avg_discount: float = 0.0


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    store_name: str | None = None
    brand_name: str
    product_name: str
    vertical: str
    category: str
    gender: str | None = None
    price: float
    original_price: float
    discount_percentage: float
    currency: str = "PKR"
    fabric: str | None = None
    color: str | None = None
    image_url: str | None = None
    product_url: str
    in_stock: bool
    is_on_sale: bool = False
    last_updated: datetime
    description: str | None = None
    store_slug: str | None = None
    store_rating: float | None = None
    store_logo: str | None = None
    protein: str | None = None
    portion: str | None = None
    unit_price: float | None = None
    unit_label: str | None = None
    attributes: dict[str, Any] = {}

    @field_serializer("price", "original_price")
    def _money(self, v: Any) -> float:
        return round(float(v), 2)


class PricePoint(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    price: float
    original_price: float
    in_stock: bool
    recorded_at: datetime


class ProductDetail(ProductOut):
    description: str | None = None
    attributes: dict[str, Any] = {}
    tags: list[str] = []
    first_seen_at: datetime
    last_price_change_at: datetime | None = None
    price_history: list[PricePoint] = []
    lowest_price: float | None = None
    highest_price: float | None = None


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
    pages: int


class SearchResponse(ProductPage):
    query: str
    parsed_filters: dict[str, Any]
    semantic: bool = False


class FacetValue(BaseModel):
    value: str
    count: int


class Facets(BaseModel):
    verticals: list[FacetValue]
    categories: list[FacetValue]
    brands: list[FacetValue]
    stores: list[FacetValue]
    genders: list[FacetValue]
    colors: list[FacetValue]
    proteins: list[FacetValue] = []
    cities: list[FacetValue] = []
    price_min: float = 0
    price_max: float = 0


class ProductQuery(BaseModel):
    """Filters accepted by listing endpoints (also used internally by agents)."""

    q: str | None = None
    vertical: str | None = None
    category: str | None = None
    gender: str | None = None
    brand: list[str] | None = None
    store: list[str] | None = None
    color: str | None = None
    fabric: str | None = None
    protein: str | None = None
    city: str | None = None
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    on_sale: bool = False
    in_stock: bool | None = True
    min_discount: float | None = Field(default=None, ge=0, le=100)
    sort: str = "relevance"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=24, ge=1, le=100)
