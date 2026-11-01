from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, utcnow


class Store(Base):
    """A restaurant (brand) whose menu we collect from its own ordering site."""

    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    website: Mapped[str] = mapped_column(String(500))
    platform: Mapped[str] = mapped_column(String(40), default="shopify")
    verticals: Mapped[list] = mapped_column(JSONType, default=list)
    logo_url: Mapped[str | None] = mapped_column(String(1000))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_scraped_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    # --- Restaurant facts (from its ordering site) ---
    cuisines: Mapped[list] = mapped_column(JSONType, default=list)
    cities: Mapped[list] = mapped_column(JSONType, default=list)
    offers: Mapped[list] = mapped_column(JSONType, default=list)  # restaurant-wide deals, e.g. 20% off delivery
    delivery_areas: Mapped[int] = mapped_column(Integer, default=0)

    # --- Google Places (filled by places-sync when a key is configured) ---
    google_place_id: Mapped[str | None] = mapped_column(String(300), index=True)
    rating: Mapped[float | None] = mapped_column(Float)
    rating_count: Mapped[int | None] = mapped_column(Integer)
    price_level: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(60))
    maps_url: Mapped[str | None] = mapped_column(String(1000))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    google_synced_at: Mapped[datetime | None]

    products = relationship("Product", back_populates="store")


class ScrapeRun(Base):
    __tablename__ = "scrape_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|success|failed
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[datetime | None]
    items_seen: Mapped[int] = mapped_column(Integer, default=0)
    items_new: Mapped[int] = mapped_column(Integer, default=0)
    items_updated: Mapped[int] = mapped_column(Integer, default=0)
    price_drops: Mapped[int] = mapped_column(Integer, default=0)
    out_of_stock: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
