"""Design and dev news crews: a researcher shortlists the day's candidates, an editor writes them up."""

import json
from dataclasses import dataclass

from crewai import LLM, Agent, Crew, Process, Task

from agents.models import BriefingItem, BriefingItems, Candidate


@dataclass(frozen=True)
class Desk:
    team: str
    focus: str


DESKS = {
    "design": Desk(
        team="tim UI/UX designer di agensi digital",
        focus=(
            "tren UI/UX hari ini: pola desain baru, fitur Figma, riset UX, aksesibilitas, design system, "
            "motion, inspirasi visual, dan tool desain yang baru rilis"
        ),
    ),
    "dev": Desk(
        team="tim web developer di agensi digital (stack: Vue, TypeScript, Bun, Hono, Drizzle, Postgres)",
        focus=(
            "berita developer hari ini: rilis penting atau breaking change di stack kami, isu keamanan, "
            "tool dan library baru yang berguna, dan diskusi teknis yang ramai"
        ),
    ),
}


def candidates_json(candidates: list[Candidate]) -> str:
    return json.dumps(
        [{"i": i, **c.model_dump(exclude_none=True)} for i, c in enumerate(candidates)],
        ensure_ascii=False,
    )


def build_news_crew(audience: str, llm: LLM, candidates: list[Candidate], limit: int, notes: str = "") -> Crew:
    desk = DESKS[audience]
    researcher = Agent(
        role="Research analyst",
        goal=f"Pilih item yang paling berguna untuk {desk.team}",
        backstory=(
            f"Kamu memantau sumber berita setiap pagi untuk {desk.team}. Kamu fokus pada {desk.focus}. "
            "Kamu mengabaikan clickbait, promosi, dan berita yang tidak bisa ditindaklanjuti."
        ),
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )
    editor = Agent(
        role="Briefing editor",
        goal="Tulis briefing pagi yang singkat dan jelas dalam Bahasa Indonesia",
        backstory="Kamu menulis briefing sebelum standup yang dibaca lewat WhatsApp: padat, tanpa basa-basi.",
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )
    shortlist = Task(
        description=(
            f"Berikut kandidat item hari ini dalam JSON:\n{candidates_json(candidates)}\n\n"
            f"Pilih maksimal {limit * 2} item paling relevan untuk {desk.team} ({desk.focus}). "
            f"{notes}\nHanya pakai item dari daftar; jangan mengarang item atau URL."
        ),
        expected_output="Daftar item terpilih: indeks `i`, judul, URL persis seperti di daftar, dan alasan singkat.",
        agent=researcher,
    )
    write_up = Task(
        description=(
            f"Dari shortlist, ambil {limit} item terbaik. Untuk tiap item isi: type='news', title (boleh "
            "dipersingkat), url dan source persis dari daftar, summary 1-2 kalimat Bahasa Indonesia tentang "
            "isinya dan kenapa penting untuk tim, dan score 0-100. Urutkan dari score tertinggi."
        ),
        expected_output=f"JSON dengan field `items` berisi maksimal {limit} item.",
        agent=editor,
        context=[shortlist],
        output_pydantic=BriefingItems,
    )
    return Crew(agents=[researcher, editor], tasks=[shortlist, write_up], process=Process.sequential, verbose=False)


def keep_known(
    items: list[BriefingItem], candidates: list[Candidate], limit: int, per_source: int | None = None
) -> list[BriefingItem]:
    """Drop anything whose URL is not one we fetched: the LLM must not invent links.
    Type, source and the facts the feed gave come from the candidate, not the LLM."""
    known = {c.url: c for c in candidates}
    out, seen, sources = [], set(), {}
    for item in sorted(items, key=lambda i: i.score, reverse=True):
        if item.url not in known or item.url in seen:
            continue
        c = known[item.url]
        if per_source and sources.get(c.source, 0) >= per_source:
            continue
        seen.add(item.url)
        sources[c.source] = sources.get(c.source, 0) + 1
        facts = {"country": item.country or c.country, "budget": item.budget or c.budget}
        if c.kind == "upsell":  # our own client: no country or budget to report
            facts = {"country": None, "budget": None}
        out.append(item.model_copy(update={"type": c.kind, "source": c.source, **facts}))
    return out[:limit]
