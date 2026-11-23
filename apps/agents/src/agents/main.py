"""Stateless CrewAI service. apps/api calls it with the workspace's context and LLM key;
it returns briefing items as JSON. Storage, dedup across days and WhatsApp delivery stay in apps/api."""

import logging
import os
import secrets

from fastapi import FastAPI, Header, HTTPException

from agents.crews.news import build_news_crew, keep_known
from agents.crews.sales import SALES_MIX, balance, per_source_cap, run_sales
from agents.llm import build_llm
from agents.models import BriefingItems, RunRequest, RunResponse
from agents.tools import feeds, leads

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
log = logging.getLogger("agents")

INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN") or "dev-internal-token"
if os.environ.get("NODE_ENV") == "production" and INTERNAL_API_TOKEN == "dev-internal-token":
    raise RuntimeError("INTERNAL_API_TOKEN must be set to a private value in production")

# Fewer candidates means fewer tokens; the researcher only needs a good spread.
MAX_CANDIDATES = 60
MAX_SALES_CANDIDATES = 100

app = FastAPI(title="team-assistant agents")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/crews/run", response_model=RunResponse)
async def run_crew(body: RunRequest, x_internal_token: str = Header(default="")) -> RunResponse:
    if not secrets.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid internal token")

    notes = str(body.context.get("notes") or "")
    profile = body.context.get("profile") or {}
    if body.audience == "sales":
        found = await leads.sales_candidates(profile, body.context.get("projects") or [], body.search_key)
        candidates = balance(feeds.dedupe(found, set(body.seen_urls)), SALES_MIX)[:MAX_SALES_CANDIDATES]
    else:
        found = await (feeds.design_candidates() if body.audience == "design" else feeds.dev_candidates())
        candidates = feeds.dedupe(found, set(body.seen_urls))[:MAX_CANDIDATES]
    if not candidates:
        return RunResponse(audience=body.audience, items=[], candidates=0, model=body.llm.model)

    llm = build_llm(body.llm)
    try:
        if body.audience == "sales":
            items, written = await run_sales(llm, candidates, profile, body.limit, notes)
            # keep_known re-checks every link against what was fetched.
            items = keep_known(items, candidates, body.limit, per_source_cap(body.limit))
        else:
            result = await build_news_crew(body.audience, llm, candidates, body.limit, notes).kickoff_async()
            parsed = result.pydantic if isinstance(result.pydantic, BriefingItems) else None
            written = len(parsed.items) if parsed else 0
            items = keep_known(parsed.items if parsed else [], candidates, body.limit)
    except Exception as err:
        log.exception("crew %s failed for workspace %s", body.audience, body.workspace_id)
        raise HTTPException(status_code=502, detail=f"LLM run failed: {err}") from err

    log.info(
        "crew %s for %s: %d candidates -> %d written -> %d kept",
        body.audience, body.workspace_id, len(candidates), written, len(items),
    )
    return RunResponse(audience=body.audience, items=items, candidates=len(candidates), model=body.llm.model)
