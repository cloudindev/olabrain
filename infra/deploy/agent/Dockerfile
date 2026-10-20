# Voice worker image for LiveKit Cloud (ADR-011). Built from the staging folder that
# infra/deploy/agent.sh assembles: apps/agent (pyproject, uv.lock, src) + config/.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/agent
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
RUN useradd --uid 10001 --create-home appuser
COPY --from=build --chown=appuser /app/apps/agent /app/apps/agent
# The worker reads ../../../../config from its package, i.e. /app/config.
COPY --chown=appuser config /app/config
USER appuser
WORKDIR /app/apps/agent
# Local models (VAD, turn detector) are baked into the image, not downloaded per session.
RUN uv run --no-sync python -m brainagent_agent.worker download-files
CMD ["uv", "run", "--no-sync", "python", "-m", "brainagent_agent.worker", "start"]
