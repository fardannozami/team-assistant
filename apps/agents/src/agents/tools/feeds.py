"""Deterministic fetchers: public RSS/JSON only, no logins. The LLM only ranks and summarises."""

import asyncio
import html
import logging
import re
from dataclasses import dataclass

import feedparser
import httpx

from agents.models import Candidate

log = logging.getLogger(__name__)

USER_AGENT = "team-assistant-briefings/0.1 (+https://github.com)"
TIMEOUT = httpx.Timeout(15.0)
PER_SOURCE = 8


@dataclass(frozen=True)
class Feed:
    source: str
    url: str


DESIGN_FEEDS = [
    Feed("Smashing Magazine", "https://www.smashingmagazine.com/feed/"),
    Feed("UX Collective", "https://uxdesign.cc/feed"),
    Feed("Nielsen Norman Group", "https://www.nngroup.com/feed/rss/"),
    Feed("Figma Blog", "https://www.figma.com/blog/feed/atom.xml"),
    Feed("Sidebar", "https://sidebar.io/feed.xml"),
    Feed("Awwwards", "https://www.awwwards.com/blog/feed/"),
    Feed("A List Apart", "https://alistapart.com/main/feed/"),
    Feed("Product Hunt", "https://www.producthunt.com/feed"),
]

DEV_FEEDS = [
    Feed("dev.to", "https://dev.to/feed"),
    Feed("JavaScript Weekly", "https://cprss.s3.amazonaws.com/javascriptweekly.com.xml"),
    Feed("Vue releases", "https://github.com/vuejs/core/releases.atom"),
    Feed("Bun releases", "https://github.com/oven-sh/bun/releases.atom"),
    Feed("Hono releases", "https://github.com/honojs/hono/releases.atom"),
    Feed("Drizzle releases", "https://github.com/drizzle-team/drizzle-orm/releases.atom"),
    Feed("TypeScript blog", "https://devblogs.microsoft.com/typescript/feed/"),
]

HN_TOP = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20"

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def clean(text: str, limit: int = 280) -> str:
    """Plain text from feed HTML, cut to `limit` characters."""
    # Feeds often escape their HTML, so unescape before stripping tags too.
    text = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", html.unescape(text or "")))).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def parse_feed(source: str, body: bytes | str, limit: int = PER_SOURCE) -> list[Candidate]:
    parsed = feedparser.parse(body)
    items = []
    for entry in parsed.entries[:limit]:
        url = entry.get("link")
        title = clean(entry.get("title", ""), 200)
        if not url or not title:
            continue
        # GitHub release titles are bare versions ("v4.13.18"): name the project.
        if source.endswith(" releases") and not title.lower().startswith(source.split()[0].lower()):
            title = f"{source.removesuffix(' releases')} {title}"
        items.append(
            Candidate(
                title=title,
                url=url,
                source=source,
                snippet=clean(entry.get("summary", "")),
                published=entry.get("published") or entry.get("updated"),
            )
        )
    return items


def parse_hn(body: dict) -> list[Candidate]:
    items = []
    for hit in body.get("hits", []):
        title = hit.get("title")
        if not title:
            continue
        url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        items.append(
            Candidate(
                title=clean(title, 200),
                url=url,
                source="Hacker News",
                snippet=f"{hit.get('points', 0)} points, {hit.get('num_comments', 0)} comments",
                published=hit.get("created_at"),
            )
        )
    return items


async def _fetch_feed(client: httpx.AsyncClient, feed: Feed) -> list[Candidate]:
    try:
        response = await client.get(feed.url)
        response.raise_for_status()
        return parse_feed(feed.source, response.content)
    except (httpx.HTTPError, ValueError) as err:  # one dead feed must not sink the briefing
        log.warning("feed %s failed: %s", feed.url, err)
        return []


async def _fetch_hn(client: httpx.AsyncClient) -> list[Candidate]:
    try:
        response = await client.get(HN_TOP)
        response.raise_for_status()
        return parse_hn(response.json())
    except (httpx.HTTPError, ValueError) as err:
        log.warning("hn failed: %s", err)
        return []


def dedupe(candidates: list[Candidate], seen_urls: set[str]) -> list[Candidate]:
    out, urls = [], set(seen_urls)
    for c in candidates:
        if c.url in urls:
            continue
        urls.add(c.url)
        out.append(c)
    return out


async def collect(feeds: list[Feed], include_hn: bool = False) -> list[Candidate]:
    async with httpx.AsyncClient(
        timeout=TIMEOUT, headers={"user-agent": USER_AGENT}, follow_redirects=True
    ) as client:
        jobs = [_fetch_feed(client, f) for f in feeds]
        if include_hn:
            jobs.append(_fetch_hn(client))
        results = await asyncio.gather(*jobs)
    return [c for batch in results for c in batch]


async def design_candidates() -> list[Candidate]:
    return await collect(DESIGN_FEEDS)


async def dev_candidates() -> list[Candidate]:
    return await collect(DEV_FEEDS, include_hn=True)
