from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, utcnow
from app.services.normalization.portion import portion_label, unit_price


class Product(Base):
    """One priced menu item at one restaurant (each size is its own item).

    `category` is the dish ("tikka", "burger", "biryani"); `attributes` holds what makes
    two dishes comparable: protein, pieces, size, pizza inches, serves, cut, menu section.
    The fashion-era columns (gender, fabric, color) stay nullable and unused.
    """

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("store_id", "external_id", name="uq_products_store_external"),
        Index("ix_products_browse", "vertical", "category", "gender", "price"),
        Index("ix_products_discount", "discount_percentage"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(120))
    brand_name: Mapped[str] = mapped_column(String(160), index=True)
    product_name: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    vertical: Mapped[str] = mapped_column(String(40), default="fashion", index=True)
    category: Mapped[str] = mapped_column(String(80), default="other", index=True)
    gender: Mapped[str | None] = mapped_column(String(20), index=True)
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    original_price: Mapped[float] = mapped_column(Numeric(12, 2))
    discount_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="PKR")
    fabric: Mapped[str | None] = mapped_column(String(80))
    color: Mapped[str | None] = mapped_column(String(60))
    attributes: Mapped[dict] = mapped_column(JSONType, default=dict)
    tags: Mapped[list] = mapped_column(JSONType, default=list)
    image_url: Mapped[str | None] = mapped_column(String(1000))
    product_url: Mapped[str] = mapped_column(String(1000))
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    first_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_updated: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    last_price_change_at: Mapped[datetime | None]

    store = relationship("Store", back_populates="products", lazy="joined")
    price_history = relationship(
        "PriceHistory", back_populates="product", cascade="all, delete-orphan", order_by="PriceHistory.recorded_at"
    )

    @property
    def store_name(self) -> str | None:
        return self.store.name if self.store else None

    @property
    def is_on_sale(self) -> bool:
        return float(self.original_price or 0) > float(self.price or 0)

    @property
    def store_slug(self) -> str | None:
        return self.store.slug if self.store else None

    @property
    def store_rating(self) -> float | None:
        return self.store.rating if self.store else None

    @property
    def store_logo(self) -> str | None:
        return self.store.logo_url if self.store else None

    @property
    def protein(self) -> str | None:
        return (self.attributes or {}).get("protein")

    @property
    def portion(self) -> str | None:
        return portion_label(self.attributes)

    @property
    def unit_price(self) -> float | None:
        up = unit_price(self.price, self.attributes, self.category)
        return up[0] if up else None

    @property
    def unit_label(self) -> str | None:
        up = unit_price(self.price, self.attributes, self.category)
        return up[1] if up else None


class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    original_price: Mapped[float] = mapped_column(Numeric(12, 2))
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    recorded_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)

    product = relationship("Product", back_populates="price_history")


class ProductEvent(Base):
    """Change events detected during ingestion: new item, price drop, stock changes."""

    __tablename__ = "product_events"
    __table_args__ = (Index("ix_product_events_type_created", "event_type", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(30))  # new_item|price_drop|price_increase|out_of_stock|back_in_stock
    old_price: Mapped[float | None] = mapped_column(Numeric(12, 2))
    new_price: Mapped[float | None] = mapped_column(Numeric(12, 2))
    drop_percentage: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    extra: Mapped[dict] = mapped_column(JSONType, default=dict)
    run_id: Mapped[int | None] = mapped_column(Integer)

    product = relationship("Product", lazy="joined")
