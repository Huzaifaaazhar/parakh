from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, utcnow


class Review(Base):
    """A review of a restaurant, optionally about one dish, with photos and videos.

    source="parakh": written on Parakh by a signed-in diner (media uploaded by them).
    source="google": imported from Google Places with the author's attribution; Google
    allows at most five per place and asks that they be refreshed, never edited.
    """

    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_reviews_source_external"),
        Index("ix_reviews_store_created", "store_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(20), default="parakh")  # parakh | google
    external_id: Mapped[str | None] = mapped_column(String(300))
    author_name: Mapped[str] = mapped_column(String(160))
    author_url: Mapped[str | None] = mapped_column(String(1000))
    author_photo: Mapped[str | None] = mapped_column(String(1000))
    rating: Mapped[float] = mapped_column(Float)
    text: Mapped[str | None] = mapped_column(Text)
    media: Mapped[list] = mapped_column(JSONType, default=list)  # [{type: photo|video, url, thumb?}]
    visited_branch: Mapped[str | None] = mapped_column(String(200))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # e.g. receipt photo checked by a moderator
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    helpful: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    store = relationship("Store", lazy="joined")
    product = relationship("Product", lazy="joined")


class AdBanner(Base):
    """A paid (or house) banner in the home-page hero slider.

    kind="sponsored" is a paid placement and is always labelled "Sponsored" in the UI;
    kind="featured" is our own editorial pick and labelled "Featured".
    """

    __tablename__ = "ad_banners"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="sponsored")
    eyebrow: Mapped[str | None] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(160))
    subtitle: Mapped[str | None] = mapped_column(String(300))
    image_url: Mapped[str | None] = mapped_column(String(1000))
    video_url: Mapped[str | None] = mapped_column(String(1000))
    cta_label: Mapped[str] = mapped_column(String(60), default="See the menu")
    link_url: Mapped[str | None] = mapped_column(String(1000))
    priority: Mapped[int] = mapped_column(Integer, default=0)
    starts_at: Mapped[datetime | None]
    ends_at: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    store = relationship("Store", lazy="joined")
