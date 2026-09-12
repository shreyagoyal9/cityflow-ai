# =============================================================================
# CityFlow AI — ML service image
# =============================================================================
# Two stages. Prophet pulls in a compiler toolchain to build its Stan backend,
# which is several hundred megabytes of build tooling that has no business in a
# running container. Building in one stage and copying only the installed
# packages into a clean runtime image roughly halves the final image.
# =============================================================================

# --------------------------------------------------------------- build stage
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /install
COPY requirements.txt .
RUN pip install --prefix=/install/deps -r requirements.txt

# ------------------------------------------------------------- runtime stage
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Run as a non-root user. This service parses caller-supplied JSON and runs a
# solver on it; there is no reason for it to have root inside its own container.
RUN useradd --create-home --shell /bin/bash cityflow

COPY --from=builder /install/deps /usr/local

WORKDIR /app
COPY --chown=cityflow:cityflow app ./app

USER cityflow
EXPOSE 8000

# Compose and any orchestrator wait on this, so the web service does not start
# talking to a half-booted model server.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
