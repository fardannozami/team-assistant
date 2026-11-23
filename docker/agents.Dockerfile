FROM python:3.12-slim-bookworm
# uv publishes no combined uv+python tag for every release; copy the pinned binary instead.
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1 UV_PYTHON_DOWNLOADS=never

COPY apps/agents/pyproject.toml apps/agents/uv.lock apps/agents/.python-version ./
RUN uv sync --frozen --no-install-project

COPY apps/agents/src ./src
RUN uv sync --frozen

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8100
CMD ["uvicorn", "agents.main:app", "--host", "0.0.0.0", "--port", "8100"]
