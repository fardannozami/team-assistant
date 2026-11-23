"""Sales sources: public job boards, tenders, funding news and an optional search API.

LinkedIn and Fiverr forbid scraping, so LinkedIn and Freelancer.com only come in through a
search API (Tavily) with the workspace's own key: links and snippets of public pages, nothing more.
Upwork is left out on purpose (BLOCKED_DOMAINS), whichever source finds it.
"""

import asyncio
import logging
import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlsplit

import httpx

from agents.models import Candidate
from agents.tools.feeds import TIMEOUT, USER_AGENT, clean, parse_feed

log = logging.getLogger(__name__)

PER_SOURCE = 12

WWR_FEEDS = [
    ("We Work Remotely", "https://weworkremotely.com/categories/remote-design-jobs.rss"),
    ("We Work Remotely", "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss"),
    ("We Work Remotely", "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss"),
]
FUNDING_FEEDS = [
    ("TechCrunch Venture", "https://techcrunch.com/category/venture/feed/"),
    ("Crunchbase News", "https://news.crunchbase.com/feed/"),
]
# Web design, graphic design, software development and IT services.
TED_CPV = "72413000 79822500 72212224 72200000 72212000 79342000"

# Platforms the agency does not take leads from, whichever source links to them.
BLOCKED_DOMAINS = ("upwork.com",)


def blocked(url: str) -> bool:
    host = urlsplit(url).hostname or ""
    return any(host == d or host.endswith(f".{d}") for d in BLOCKED_DOMAINS)


# Used when the agency profile has no keywords yet.
DEFAULT_KEYWORDS = ["UI/UX design", "web development", "mobile app", "Figma", "landing page", "website redesign"]


_CONTRACT = re.compile(r"\b(?<!smart )(contract|contractor|freelance|freelancer|part[- ]time|project[- ]based|temporary)\b", re.IGNORECASE)


def kind_for(*texts: str | None) -> str:
    """lead when the post is contract or freelance work an agency can take; otherwise a hiring signal."""
    return "lead" if any(t and _CONTRACT.search(t) for t in texts) else "hiring"


def money(lo: float | None, hi: float | None, currency: str = "USD") -> str | None:
    lo, hi = lo or 0, hi or 0
    if not lo and not hi:
        return None
    if lo and hi and lo != hi:
        return f"{currency} {lo:,.0f}–{hi:,.0f}"
    return f"{currency} {(hi or lo):,.0f}"


def parse_remoteok(body: list) -> list[Candidate]:
    out = []
    for job in body[1:]:  # the first element is a legal notice
        if not isinstance(job, dict) or not job.get("url") or not job.get("position"):
            continue
        out.append(
            Candidate(
                kind=kind_for(job["position"], " ".join(job.get("tags") or [])),
                title=f"{clean(job['position'], 150)} — {job.get('company', '')}".strip(" —"),
                url=job["url"],
                source="RemoteOK",
                snippet=clean(job.get("description", "")),
                published=job.get("date"),
                country=job.get("location") or None,
                budget=money(job.get("salary_min"), job.get("salary_max")),
            )
        )
    return out


def parse_himalayas(body: dict) -> list[Candidate]:
    out = []
    for job in body.get("jobs", []):
        url = job.get("guid") or job.get("applicationLink")
        if not url or not job.get("title"):
            continue
        out.append(
            Candidate(
                kind=kind_for(job.get("employmentType"), job["title"]),
                title=f"{clean(job['title'], 150)} — {job.get('companyName', '')}".strip(" —"),
                url=url,
                source="Himalayas",
                snippet=f"{job.get('employmentType', '')}. {clean(job.get('excerpt', ''))}".strip(". "),
                country=", ".join(job.get("locationRestrictions") or []) or None,
                budget=money(job.get("minSalary"), job.get("maxSalary"), job.get("currency") or "USD"),
            )
        )
    return out


def parse_jobicy(body: dict) -> list[Candidate]:
    out = []
    for job in body.get("jobs", []):
        if not job.get("url") or not job.get("jobTitle"):
            continue
        out.append(
            Candidate(
                kind=kind_for(" ".join(job.get("jobType") or []), job["jobTitle"]),
                title=f"{clean(job['jobTitle'], 150)} — {job.get('companyName', '')}".strip(" —"),
                url=job["url"],
                source="Jobicy",
                snippet=f"{', '.join(job.get('jobType') or [])}. {clean(job.get('jobExcerpt', ''))}".strip(". "),
                published=job.get("pubDate"),
                country=job.get("jobGeo") or None,
                budget=money(job.get("annualSalaryMin"), job.get("annualSalaryMax"), job.get("salaryCurrency") or "USD"),
            )
        )
    return out


def parse_hn_comments(body: dict) -> list[Candidate]:
    out = []
    for hit in body.get("hits", []):
        text = clean(hit.get("comment_text", ""), 400)
        # Hiring posts open "Company | Role | Location"; skip people offering themselves.
        if "|" not in text[:150] or text.upper().startswith(("SEEKING", "FREELANCER")):
            continue
        out.append(
            Candidate(
                kind="lead",
                title=clean(text.split("|")[0], 80) + " (HN Who is hiring)",
                url=f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
                source="Hacker News",
                snippet=text,
                published=hit.get("created_at"),
            )
        )
    return out


def parse_ted(body: dict) -> list[Candidate]:
    out = []
    for notice in body.get("notices", []):
        number = notice.get("publication-number")
        titles = notice.get("notice-title") or {}
        title = titles.get("eng") or next(iter(titles.values()), "") if isinstance(titles, dict) else str(titles)
        if not number or not title:
            continue
        buyer = notice.get("buyer-name") or {}
        buyer = next(iter(buyer.values()), [""])[0] if isinstance(buyer, dict) else ""
        deadline = (notice.get("deadline-receipt-tender-date-lot") or [None])[0]
        out.append(
            Candidate(
                kind="tender",
                title=clean(title, 200),
                url=f"https://ted.europa.eu/en/notice/-/detail/{number}",
                source="TED (EU tenders)",
                snippet=clean(f"Buyer: {buyer}. Deadline: {deadline or '-'}"),
                published=notice.get("publication-date"),
                country=", ".join(notice.get("buyer-country") or []) or None,
            )
        )
    return out


def parse_worldbank(body: dict) -> list[Candidate]:
    out = []
    notices = body.get("procnotices", [])
    for n in notices if isinstance(notices, list) else []:
        if not n.get("id") or not n.get("bid_description"):
            continue
        out.append(
            Candidate(
                kind="tender",
                title=clean(n["bid_description"], 200),
                url=f"https://projects.worldbank.org/en/projects-operations/procurement-detail/{n['id']}",
                source="World Bank procurement",
                snippet=clean(
                    f"{n.get('notice_type', '')}. {n.get('project_name', '')}. "
                    f"Deadline: {(n.get('submission_deadline_date') or '-')[:10]}"
                ),
                published=n.get("noticedate"),
                country=n.get("project_ctry_name") or None,
            )
        )
    return out


# Search also finds articles about hiring ("RFP template", "how to hire a WordPress developer").
_ARTICLE = re.compile(
    r"\b(templates?|how to|guide|tips|examples?|best \d*|top \d+|cost of|vs\.?|tutorial|checklist|blog)\b",
    re.IGNORECASE,
)


def parse_tavily(body: dict, source: str) -> list[Candidate]:
    return [
        Candidate(kind="lead", title=clean(r["title"], 200), url=r["url"], source=source, snippet=clean(r.get("content", "")))
        for r in body.get("results", [])
        if r.get("url") and r.get("title") and not _ARTICLE.search(r["title"])
    ]


async def _get(client: httpx.AsyncClient, url: str, parse, **kwargs) -> list[Candidate]:
    try:
        response = await client.get(url, **kwargs)
        response.raise_for_status()
        return parse(response.json())[:PER_SOURCE]
    except (httpx.HTTPError, ValueError) as err:  # one dead source must not sink the briefing
        log.warning("source %s failed: %s", url, err)
        return []


async def _rss(client: httpx.AsyncClient, source: str, url: str, kind: str | None) -> list[Candidate]:
    """kind None: a job board, labelled per post by kind_for."""
    try:
        response = await client.get(url)
        response.raise_for_status()
        return [
            c.model_copy(update={"kind": kind or kind_for(c.title, c.snippet)})
            for c in parse_feed(source, response.content, PER_SOURCE)
        ]
    except (httpx.HTTPError, ValueError) as err:
        log.warning("feed %s failed: %s", url, err)
        return []


async def _jobicy(client: httpx.AsyncClient) -> list[Candidate]:
    """One industry at a time: Jobicy refuses parallel requests."""
    out = []
    for industry in ("design-multimedia", "engineering"):
        out += await _get(client, "https://jobicy.com/api/v2/remote-jobs", parse_jobicy, params={"count": 15, "industry": industry})
    return out


async def _hn_hiring(client: httpx.AsyncClient, keywords: list[str]) -> list[Candidate]:
    """Contract, freelance and keyword posts in this month's "Who is hiring?" thread."""
    words = " ".join(["contract", "freelance", *(t for k in keywords for t in keyword_tokens(k))])
    try:
        stories = await client.get(
            "https://hn.algolia.com/api/v1/search_by_date",
            params={"tags": "story,author_whoishiring", "hitsPerPage": 5},
        )
        stories.raise_for_status()
        # The bot also posts "Who wants to be hired?": people looking for work, not leads.
        hits = [h for h in stories.json().get("hits", []) if "who is hiring" in (h.get("title") or "").lower()]
        if not hits:
            return []
        comments = await client.get(
            "https://hn.algolia.com/api/v1/search",
            params={"tags": f"comment,story_{hits[0]['objectID']}", "query": words, "hitsPerPage": 40,
                    "optionalWords": words},
        )
        comments.raise_for_status()
        return parse_hn_comments(comments.json())[: PER_SOURCE * 2]
    except (httpx.HTTPError, ValueError, KeyError) as err:
        log.warning("hn hiring failed: %s", err)
        return []


async def _ted(client: httpx.AsyncClient, since: date) -> list[Candidate]:
    try:
        response = await client.post(
            "https://api.ted.europa.eu/v3/notices/search",
            json={
                "query": f"classification-cpv IN ({TED_CPV}) AND publication-date>={since:%Y%m%d}",
                "fields": ["publication-number", "notice-title", "buyer-country", "publication-date",
                           "deadline-receipt-tender-date-lot", "buyer-name"],
                "limit": PER_SOURCE,
                "scope": "ACTIVE",
            },
        )
        response.raise_for_status()
        return parse_ted(response.json())
    except (httpx.HTTPError, ValueError) as err:
        log.warning("ted failed: %s", err)
        return []


async def _tavily(client: httpx.AsyncClient, key: str, query: str, source: str, domains: list[str]) -> list[Candidate]:
    try:
        response = await client.post(
            "https://api.tavily.com/search",
            headers={"authorization": f"Bearer {key}"},
            json={
                "query": query,
                "max_results": 8,
                "time_range": "week",
                "include_domains": domains,
                "exclude_domains": list(BLOCKED_DOMAINS),
            },
        )
        response.raise_for_status()
        return parse_tavily(response.json(), source)
    except (httpx.HTTPError, ValueError) as err:
        log.warning("tavily %s failed: %s", source, err)
        return []


def search_queries(keywords: list[str]) -> list[tuple[str, str, list[str]]]:
    """(query, source label, domains) per platform; public pages only."""
    terms = " OR ".join(f'"{k}"' for k in keywords[:4])
    return [
        (f"looking for agency OR freelancer {terms}", "LinkedIn (search)", ["linkedin.com"]),
        (f"{terms} project", "Freelancer.com (search)", ["freelancer.com"]),
        (f"RFP OR \"request for proposal\" {terms}", "RFP (search)", []),
    ]


def project_candidates(projects: list[dict], today: date) -> list[Candidate]:
    """Our own client projects as upsell candidates; one link per project per month, so an idea can come back."""
    out = []
    for p in projects:
        if not p.get("id") or not p.get("name"):
            continue
        out.append(
            Candidate(
                kind="upsell",
                title=f"{p['name']} ({p.get('platform', '')})",
                url=f"upsell://project/{p['id']}/{today:%Y-%m}",
                source="Proyek kita",
                snippet=clean(
                    f"Tipe: {p.get('type')}. Status: {p.get('status')}. "
                    f"Selesai: {p.get('endDate') or '-'}. Catatan: {p.get('notes') or '-'}"
                ),
            )
        )
    return out


def keyword_tokens(keyword: str) -> list[str]:
    """"UI/UX" -> ["ui", "ux"]; "WordPress" -> ["wordpress"]."""
    return [t for t in re.split(r"[\s/,&+]+", keyword.lower()) if len(t) >= 2]


def keyword_slugs(keywords: list[str]) -> list[str]:
    """RemoteOK tags for single-word keywords: "WordPress" -> "wordpress"."""
    return [k.lower() for k in keywords if re.fullmatch(r"[A-Za-z0-9.-]+", k)]


def matches(candidate: Candidate, keywords: list[str]) -> bool:
    text = f"{candidate.title} {candidate.snippet}".lower()
    return any(re.search(rf"\b{re.escape(t)}\b", text) for k in keywords for t in keyword_tokens(k))


def mark_focus(candidates: list[Candidate], keywords: list[str]) -> list[Candidate]:
    return [c.model_copy(update={"focus": matches(c, keywords)}) for c in candidates]


async def _himalayas_search(client: httpx.AsyncClient, keyword: str) -> list[Candidate]:
    found = await _get(client, "https://himalayas.app/jobs/api/search", parse_himalayas, params={"q": keyword})
    return [c.model_copy(update={"source": "Himalayas"}) for c in found]


async def sales_candidates(profile: dict, projects: list[dict], search_key: str | None = None) -> list[Candidate]:
    focus = [k for k in (profile.get("keywords") or []) if k]
    keywords = focus + [k for k in profile.get("services") or [] if k and k not in focus] or DEFAULT_KEYWORDS
    today = datetime.now(UTC).date()

    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"user-agent": USER_AGENT}, follow_redirects=True) as client:
        jobs = [
            *(_rss(client, source, url, None) for source, url in WWR_FEEDS),
            _get(client, "https://remoteok.com/api", parse_remoteok, params={"tag": "design"}),
            _get(client, "https://remoteok.com/api", parse_remoteok, params={"tag": "dev"}),
            _get(client, "https://himalayas.app/jobs/api", parse_himalayas, params={"limit": 20}),
            _jobicy(client),
            _hn_hiring(client, keywords),
            # Searched by the agency's own keywords: the most targeted leads of the day.
            *(_himalayas_search(client, k) for k in keywords[:5]),
            *(
                _get(client, "https://remoteok.com/api", parse_remoteok, params={"tag": slug})
                for slug in keyword_slugs(keywords)[:5]
            ),
            *(_rss(client, source, url, "funding") for source, url in FUNDING_FEEDS),
        ]
        if profile.get("tendersEnabled", True):
            jobs.append(_ted(client, today - timedelta(days=7)))
            jobs.append(
                _get(
                    client,
                    "https://search.worldbank.org/api/v2/procnotices",
                    parse_worldbank,
                    params={"format": "json", "rows": PER_SOURCE, "qterm": "website OR digital OR software OR design",
                            "srt": "noticedate", "order": "desc"},
                )
            )
        if search_key:
            jobs.extend(_tavily(client, search_key, q, source, domains) for q, source, domains in search_queries(keywords))
        results = await asyncio.gather(*jobs)

    excluded = [k.lower() for k in profile.get("excludedKeywords") or []]
    candidates = [
        c for batch in results for c in batch
        if not blocked(c.url) and not any(k in f"{c.title} {c.snippet}".lower() for k in excluded)
    ]
    return mark_focus(candidates, keywords) + project_candidates(projects, today)
