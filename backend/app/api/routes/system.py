from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import ScrapeRun, Store
from app.services.llm.router import get_llm
from app.services.normalization.taxonomy import CATEGORIES_BY_VERTICAL

router = APIRouter(tags=["system"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "llm_enabled": get_llm().enabled}


@router.get("/taxonomy", summary="Verticals and their categories")
def taxonomy():
    return CATEGORIES_BY_VERTICAL


class ScrapeRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    items_seen: int
    items_new: int
    items_updated: int
    price_drops: int
    out_of_stock: int
    error: str | None


def _admin(x_admin_key: str | None = Header(default=None)) -> None:
    if x_admin_key != settings.secret_key:
        raise HTTPException(status_code=403, detail="Admin key required")


@router.get("/admin/scrape-runs", response_model=list[ScrapeRunOut], dependencies=[Depends(_admin)])
def scrape_runs(limit: int = 50, db: Session = Depends(get_db)):
    return db.scalars(select(ScrapeRun).order_by(ScrapeRun.started_at.desc()).limit(min(limit, 200))).all()


@router.post("/admin/scrape", dependencies=[Depends(_admin)], summary="Queue a background scrape (never runs inline)")
def trigger_scrape(store: str | None = None, db: Session = Depends(get_db)):
    from app.workers.tasks import scrape_all_stores, scrape_store

    if store:
        if not db.scalar(select(Store.id).where(Store.slug == store)) and store not in _configured_slugs():
            raise HTTPException(status_code=404, detail="Unknown store")
        job = scrape_store.delay(store)
    else:
        job = scrape_all_stores.delay()
    return {"queued": True, "task_id": job.id}


def _configured_slugs() -> set[str]:
    from app.scrapers.registry import load_store_configs

    return {c.slug for c in load_store_configs()}
