from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.cache import cached
from app.db.session import get_db
from app.models import User
from app.schemas.food import BannerIn, BannerOut, OffersResponse, RestaurantDetail, RestaurantSummary, ReviewOut
from app.services import restaurant_service as svc

router = APIRouter(tags=["restaurants"])


@cached("restaurants:list")
def _list(db: Session, *, city: str | None, cuisine: str | None, q: str | None) -> list[dict]:
    return svc.list_restaurants(db, city=city, cuisine=cuisine, q=q)


@router.get("/restaurants", response_model=list[RestaurantSummary], summary="Restaurants we track, with menu stats and offers")
def restaurants(city: str | None = None, cuisine: str | None = None, q: str | None = None, db: Session = Depends(get_db)):
    return _list(db, city=city, cuisine=cuisine, q=q)


@router.get("/restaurants/{slug}", response_model=RestaurantDetail, summary="Menu by section, offers and reviews")
def restaurant(slug: str, db: Session = Depends(get_db)):
    return svc.restaurant_detail(db, slug)


@router.get("/offers", response_model=OffersResponse, summary="Restaurant-wide offers, combo deals and discounted dishes")
def offers(city: str | None = None, limit: int = 24, db: Session = Depends(get_db)):
    return svc.offers(db, city=city, limit=min(limit, 60))


@router.get("/reviews", response_model=list[ReviewOut], summary="Latest reviews; with_media=true for the photo/video wall")
def reviews(
    restaurant: str | None = None,
    product_id: int | None = None,
    with_media: bool = False,
    source: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    store_id = svc.get_store(db, restaurant).id if restaurant else None
    return svc.list_reviews(db, store_id=store_id, product_id=product_id, with_media=with_media, source=source, limit=min(limit, 60))


@router.post("/restaurants/{slug}/reviews", response_model=ReviewOut, status_code=201, summary="Post a review with photos/videos")
async def post_review(
    slug: str,
    rating: float = Form(..., ge=1, le=5),
    text: str | None = Form(default=None, max_length=4000),
    product_id: int | None = Form(default=None),
    visited_branch: str | None = Form(default=None, max_length=200),
    files: list[UploadFile] = File(default_factory=list),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    media = []
    for f in files[: svc.MAX_MEDIA_PER_REVIEW + 1]:
        media.append(svc.save_media(f.filename or "file", f.content_type or "", await f.read()))
    return svc.create_review(
        db, slug=slug, user=user, rating=rating, text=text, product_id=product_id, visited_branch=visited_branch, media=media
    )


@router.get("/banners", response_model=list[BannerOut], summary="Home-page hero banners (sponsored first)")
def banners(db: Session = Depends(get_db)):
    return svc.active_banners(db)


@router.post("/banners/{banner_id}/click", status_code=204, summary="Count a banner click")
def banner_click(banner_id: int, db: Session = Depends(get_db)):
    try:
        svc.record_banner_click(db, banner_id)
    except Exception:  # noqa: BLE001  (read-only demo databases can't count clicks)
        db.rollback()


@router.post("/admin/banners", response_model=BannerOut, status_code=201, dependencies=[Depends(require_admin)])
def create_banner(body: BannerIn, db: Session = Depends(get_db)):
    return svc.upsert_banner(db, body.model_dump())


@router.put("/admin/banners/{banner_id}", response_model=BannerOut, dependencies=[Depends(require_admin)])
def update_banner(banner_id: int, body: BannerIn, db: Session = Depends(get_db)):
    return svc.upsert_banner(db, body.model_dump(), banner_id)
