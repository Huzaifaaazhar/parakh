from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import chat, compare, deals, products, restaurants, system, users
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import get_logger, setup_logging

setup_logging()
log = get_logger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info(
        "%s API starting (env=%s, llm=%s, vector=%s)",
        settings.app_name,
        settings.environment,
        settings.llm_provider,
        settings.vector_backend,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.app_name} API",
        description="Compare the same dish across Pakistani restaurants: menus, prices per portion, live offers and reviews with photos and videos.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    register_exception_handlers(app)

    api = APIRouter(prefix=settings.api_prefix)
    # compare must be registered before products so /products/{id}/alternatives isn't shadowed.
    for module in (compare, products, deals, restaurants, chat, users, system):
        api.include_router(module.router)
    app.include_router(api)

    # Review photos/videos uploaded by diners.
    media = Path(settings.media_dir)
    try:
        media.mkdir(parents=True, exist_ok=True)
        app.mount(settings.media_url_prefix, StaticFiles(directory=media), name="media")
    except OSError:  # read-only file system (serverless demo): uploads are disabled there
        log.info("media dir %s not writable; review uploads disabled", media)

    @app.get("/", include_in_schema=False)
    def root():
        return {"name": settings.app_name, "docs": "/docs", "api": settings.api_prefix}

    return app


app = create_app()
