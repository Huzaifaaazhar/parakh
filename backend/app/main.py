from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import chat, compare, deals, products, system, users
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
        description="Search, compare and track sales across Pakistani online stores — fashion, electronics, beauty and home.",
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
    for module in (compare, products, deals, chat, users, system):
        api.include_router(module.router)
    app.include_router(api)

    @app.get("/", include_in_schema=False)
    def root():
        return {"name": settings.app_name, "docs": "/docs", "api": settings.api_prefix}

    return app


app = create_app()
