# syntax=docker/dockerfile:1
FROM python:3.12.10-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# git: Scrapling / MemPalace are installed from the project's GitHub forks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements*.txt ./
RUN pip install -r requirements.txt

# Local sentence-transformers embeddings (CPU torch keeps the image ~1GB smaller than CUDA).
ARG INSTALL_ML=true
RUN if [ "$INSTALL_ML" = "true" ]; then \
      pip install --index-url https://download.pytorch.org/whl/cpu torch \
      && pip install -r requirements-ml.txt ; \
    fi

# Optional MemPalace (assistant memory) and LEANN (compact vector index).
ARG INSTALL_OPTIONAL=false
RUN if [ "$INSTALL_OPTIONAL" = "true" ]; then pip install -r requirements-optional.txt ; fi

# Headless Chromium: restaurant menus on ordering platforms (Indolj) are read by loading the site.
# Needed by the scraping worker; the API-only image can build with INSTALL_BROWSERS=false.
ARG INSTALL_BROWSERS=true
RUN if [ "$INSTALL_BROWSERS" = "true" ]; then scrapling install ; fi

COPY backend/ ./

RUN useradd --create-home --uid 1000 parakh && mkdir -p /app/data && chown -R parakh /app
USER parakh

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
