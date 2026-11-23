"""Sales/PM crew. A scout scores the day's candidates against the agency profile; code picks exactly
`limit` of them; a writer adds summaries and pitches in small batches. Small models stop early on one
long list, so the count is decided here and not left to the LLM."""

import json
import logging

from crewai import LLM, Agent, Crew, Process, Task
from pydantic import BaseModel

from agents.crews.news import candidates_json
from agents.models import BriefingItem, BriefingItems, Candidate

log = logging.getLogger(__name__)

WRITE_BATCH = 5
# Score given to candidates added only to reach `limit`.
TOP_UP_SCORE = 40

SCOUT_BACKSTORY = (
    "Kamu business developer agensi digital dari Indonesia yang melayani klien dari negara mana pun. "
    "Kamu tahu bedanya proyek yang bisa dikerjakan agensi (kontrak, freelance, tender, redesign, MVP) "
    "dengan lowongan karyawan tetap. Lowongan tetap hanya menarik sebagai sinyal: perusahaan itu butuh "
    "desain/dev dan mungkin mau outsourcing."
)


class Pick(BaseModel):
    i: int
    score: int


class Shortlist(BaseModel):
    picks: list[Pick]


def profile_text(profile: dict) -> str:
    def listed(key: str, empty: str) -> str:
        return ", ".join(profile.get(key) or []) or empty

    budget = profile.get("minBudgetUsd")
    return (
        f"Layanan: {listed('services', 'UI/UX design, web & mobile development')}\n"
        f"Kata kunci: {listed('keywords', '-')}\n"
        f"Hindari: {listed('excludedKeywords', '-')}\n"
        f"Negara target: {listed('targetCountries', 'semua negara')}\n"
        f"Budget minimum: {f'USD {budget:,}' if budget else 'tidak ada'}"
    )


def per_source_cap(limit: int) -> int:
    """At most a quarter of the briefing from one source, never fewer than 2."""
    return max(2, -(-limit // 4))


def build_scout_crew(llm: LLM, candidates: list[Candidate], profile: dict, want: int, notes: str = "") -> Crew:
    scout = Agent(
        role="Lead qualifier",
        goal="Temukan peluang proyek yang paling mungkin dimenangkan agensi hari ini",
        backstory=SCOUT_BACKSTORY,
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )
    qualify = Task(
        description=(
            f"Profil agensi:\n{profile_text(profile)}\n\n"
            "Kandidat hari ini dalam JSON (`kind`: lead = proyek/kontrak, tender = tender/RFP, "
            "hiring = lowongan sebagai sinyal outsourcing, funding = startup baru dapat pendanaan, "
            "upsell = proyek klien kita sendiri; `focus: true` = menyebut kata kunci agensi):\n"
            f"{candidates_json(candidates)}\n\n"
            "Nilai kandidat 0-100: cocok dengan layanan dan kata kunci agensi, peluang menang, budget, negara "
            "target, dan seberapa jelas kebutuhannya. Lewati yang di luar layanan (misal konstruksi, akuntansi, "
            "data entry), serta artikel, template, atau panduan yang bukan permintaan proyek nyata. Funding hanya relevan kalau startup itu kemungkinan butuh desain/produk digital. "
            "Upsell hanya kalau ada ide lanjutan yang masuk akal (maintenance, fitur baru, redesign, desain ke "
            f"development). {notes}\n"
            f"Kembalikan {want} kandidat terbaik sebagai `picks`: indeks `i` dari daftar dan `score`."
        ),
        expected_output=f"JSON dengan field `picks` berisi {want} objek {{i, score}}.",
        agent=scout,
        output_pydantic=Shortlist,
    )
    return Crew(agents=[scout], tasks=[qualify], process=Process.sequential, verbose=False)


def select(picks: list[Pick], candidates: list[Candidate], limit: int, per_source: int) -> list[tuple[Candidate, int]]:
    """Exactly `limit` candidates when there are enough: the scout's picks by score, then keyword
    matches and leads it skipped, with at most `per_source` per source."""
    chosen: list[tuple[Candidate, int]] = []
    used: set[int] = set()
    sources: dict[str, int] = {}

    def take(i: int, score: int) -> None:
        c = candidates[i]
        if i in used or len(chosen) >= limit or sources.get(c.source, 0) >= per_source:
            return
        used.add(i)
        sources[c.source] = sources.get(c.source, 0) + 1
        chosen.append((c, score))

    for p in sorted(picks, key=lambda p: p.score, reverse=True):
        if 0 <= p.i < len(candidates) and p.score > 0:
            take(p.i, p.score)
    preferred = sorted(range(len(candidates)), key=lambda i: (not candidates[i].focus, candidates[i].kind != "lead"))
    for i in preferred:
        take(i, TOP_UP_SCORE)
    return chosen


def build_writer_crew(llm: LLM, batch: list[tuple[Candidate, int]], profile: dict) -> Crew:
    writer = Agent(
        role="Pitch writer",
        goal="Tulis ringkasan dan kalimat pembuka pitch yang membuat klien mau membalas",
        backstory="Kamu menulis pitch singkat, spesifik ke kebutuhan klien, tanpa kalimat template yang basi.",
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )
    rows = [{**c.model_dump(exclude_none=True, exclude={"focus"}), "score": score} for c, score in batch]
    write_up = Task(
        description=(
            f"Profil agensi:\n{profile_text(profile)}\n\n"
            f"Tulis briefing untuk SEMUA {len(batch)} peluang ini (JSON):\n{json.dumps(rows, ensure_ascii=False)}\n\n"
            "Untuk tiap item isi: type = kind, title (singkat dan jelas, sebut perusahaan bila ada), url dan "
            "source persis seperti di atas, score seperti di atas, summary 1-2 kalimat Bahasa Indonesia (apa "
            "yang dibutuhkan dan kenapa cocok untuk kita), country dan budget bila diketahui, dan pitch: 1-2 "
            "kalimat pembuka dalam Bahasa Inggris yang bisa langsung dikirim ke klien (untuk upsell: ide "
            "penawaran ke klien itu dalam Bahasa Indonesia)."
        ),
        expected_output=f"JSON dengan field `items` berisi tepat {len(batch)} item.",
        agent=writer,
        output_pydantic=BriefingItems,
    )
    return Crew(agents=[writer], tasks=[write_up], process=Process.sequential, verbose=False)


def fallback_item(c: Candidate, score: int) -> BriefingItem:
    """For a pick the writer skipped: still worth sending, with the post's own text."""
    return BriefingItem(
        type=c.kind, title=c.title, url=c.url, source=c.source, summary=c.snippet[:280] or c.title,
        score=score, country=c.country, budget=c.budget,
    )


async def run_sales(
    llm: LLM, candidates: list[Candidate], profile: dict, limit: int, notes: str = ""
) -> tuple[list[BriefingItem], int]:
    """Items in score order, and how many the writer wrote itself."""
    scout = await build_scout_crew(llm, candidates, profile, limit * 2, notes).kickoff_async()
    picks = scout.pydantic.picks if isinstance(scout.pydantic, Shortlist) else []
    chosen = select(picks, candidates, limit, per_source_cap(limit))
    log.info("sales scout: %d picks -> %d chosen", len(picks), len(chosen))

    written: dict[str, BriefingItem] = {}
    # One batch after another: free-tier keys allow only a few requests per minute.
    for start in range(0, len(chosen), WRITE_BATCH):
        batch = chosen[start : start + WRITE_BATCH]
        try:
            result = await build_writer_crew(llm, batch, profile).kickoff_async()
        except Exception:
            log.exception("sales writer batch failed")
            continue
        if isinstance(result.pydantic, BriefingItems):
            written.update({i.url: i for i in result.pydantic.items})

    items = []
    for c, score in chosen:
        item = written.get(c.url)
        # Type, source, link and score are ours; the writer only adds words.
        items.append(item.model_copy(update={"score": score}) if item else fallback_item(c, score))
    return sorted(items, key=lambda i: i.score, reverse=True), sum(c.url in written for c, _ in chosen)


def balance(candidates: list[Candidate], per_kind: dict[str, int]) -> list[Candidate]:
    """Keyword matches first, each group round-robin across sources, then a cap per kind: one busy
    job board can't crowd out Hacker News or the three tenders of the day."""

    def interleave(group: list[Candidate]) -> list[Candidate]:
        by_source: dict[str, list[Candidate]] = {}
        for c in group:
            by_source.setdefault(c.source, []).append(c)
        queues = list(by_source.values())
        return [q[i] for i in range(max(map(len, queues), default=0)) for q in queues if i < len(q)]

    ordered = interleave([c for c in candidates if c.focus]) + interleave([c for c in candidates if not c.focus])
    counts: dict[str, int] = {}
    out = []
    for c in ordered:
        counts[c.kind] = counts.get(c.kind, 0) + 1
        if counts[c.kind] <= per_kind.get(c.kind, 10):
            out.append(c)
    return out


SALES_MIX = {"lead": 45, "hiring": 20, "tender": 15, "funding": 10, "upsell": 8}
