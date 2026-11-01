from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.product import ProductOut, StoreOut


class RestaurantSummary(StoreOut):
    menu_items: int = 0
    dishes: list[str] = []  # most common dish categories on the menu
    min_price: float | None = None
    median_price: float | None = None
    cover_image: str | None = None
    review_count: int = 0
    parakh_rating: float | None = None  # average of reviews written on Parakh
    media_count: int = 0


class MenuSection(BaseModel):
    name: str
    items: list[ProductOut]


class ReviewMedia(BaseModel):
    type: str  # photo | video
    url: str
    thumb: str | None = None


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    restaurant_name: str | None = None
    restaurant_slug: str | None = None
    product_id: int | None = None
    dish_name: str | None = None
    source: str
    author_name: str
    author_url: str | None = None
    author_photo: str | None = None
    rating: float
    text: str | None = None
    media: list[ReviewMedia] = []
    visited_branch: str | None = None
    verified: bool = False
    helpful: int = 0
    created_at: datetime


class RestaurantDetail(BaseModel):
    restaurant: RestaurantSummary
    sections: list[MenuSection]
    reviews: list[ReviewOut]
    rating_breakdown: dict[str, int] = {}


class BannerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    eyebrow: str | None = None
    title: str
    subtitle: str | None = None
    image_url: str | None = None
    video_url: str | None = None
    cta_label: str
    link_url: str | None = None
    restaurant_slug: str | None = None
    restaurant_name: str | None = None


class BannerIn(BaseModel):
    store_slug: str | None = None
    kind: str = Field(default="sponsored", pattern="^(sponsored|featured)$")
    eyebrow: str | None = Field(default=None, max_length=80)
    title: str = Field(max_length=160)
    subtitle: str | None = Field(default=None, max_length=300)
    image_url: str | None = None
    video_url: str | None = None
    cta_label: str = Field(default="See the menu", max_length=60)
    link_url: str | None = None
    priority: int = 0
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True


class OfferOut(BaseModel):
    restaurant: RestaurantSummary
    offer: dict[str, Any]


class OffersResponse(BaseModel):
    restaurant_offers: list[OfferOut]
    deal_items: list[ProductOut]  # combos and platters, best value first
    discounted: list[ProductOut]  # menu items currently priced below their menu price
