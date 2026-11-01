from celery import Celery
from celery.schedules import crontab

from app.core.config import settings
from app.core.logging import setup_logging

setup_logging()

celery_app = Celery("parakh", broker=settings.broker_url, backend=settings.result_backend, include=["app.workers.tasks"])
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Karachi",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=60 * 60,
    task_soft_time_limit=55 * 60,
    result_expires=24 * 3600,
    task_routes={
        "app.workers.tasks.scrape_store": {"queue": "scraping"},
        "app.workers.tasks.scrape_all_stores": {"queue": "scraping"},
        "app.workers.tasks.index_products_task": {"queue": "indexing"},
    },
    beat_schedule={
        "scrape-all-stores": {
            "task": "app.workers.tasks.scrape_all_stores",
            "schedule": crontab(minute=15, hour=f"*/{settings.scrape_interval_hours}"),
        },
        "full-reindex-nightly": {
            "task": "app.workers.tasks.index_products_task",
            "schedule": crontab(minute=30, hour=4),
            "kwargs": {"product_ids": None},
        },
        # Google asks for Places content to be refreshed rather than kept; weekly is plenty for ratings.
        "google-places-weekly": {
            "task": "app.workers.tasks.sync_google_places",
            "schedule": crontab(minute=45, hour=3, day_of_week=1),
        },
    },
)
