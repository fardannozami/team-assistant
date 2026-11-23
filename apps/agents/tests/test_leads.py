from datetime import date

from agents.crews.sales import balance, profile_text
from agents.models import Candidate
from agents.tools.leads import (
    kind_for,
    money,
    parse_hn_comments,
    parse_jobicy,
    parse_remoteok,
    parse_ted,
    parse_worldbank,
    project_candidates,
    search_queries,
)


def test_kind_for_contract_work_vs_hiring_signal():
    assert kind_for("Senior Product Designer") == "hiring"
    assert kind_for("Figma designer", "Contract, 3 months") == "lead"
    assert kind_for("Part-time Vue developer") == "lead"
    assert kind_for("Smart Contract Engineer") == "hiring"
    assert kind_for(None, "") == "hiring"


def test_money():
    assert money(0, 0) is None
    assert money(None, None) is None
    assert money(70, 84) == "USD 70–84"
    assert money(50000, None, "EUR") == "EUR 50,000"


def test_parse_remoteok_skips_legal_notice():
    body = [
        {"legal": "terms"},
        {"position": "UI Designer", "company": "Acme", "url": "https://remoteok.com/1", "salary_min": 60000,
         "salary_max": 80000, "location": "Worldwide", "tags": ["design"]},
        {"position": "No url"},
    ]
    [job] = parse_remoteok(body)
    assert job.title == "UI Designer — Acme"
    assert (job.kind, job.country, job.budget) == ("hiring", "Worldwide", "USD 60,000–80,000")


def test_parse_jobicy_contract_is_lead():
    [job] = parse_jobicy({"jobs": [{"jobTitle": "Webflow dev", "companyName": "B", "url": "https://jobicy.com/1",
                                    "jobType": ["Contract"], "jobGeo": "USA"}]})
    assert (job.kind, job.country) == ("lead", "USA")


def test_parse_hn_keeps_hiring_format_only():
    body = {"hits": [
        {"objectID": "1", "comment_text": "Acme | Frontend contractor | REMOTE | $90/hr<p>We need Vue help"},
        {"objectID": "2", "comment_text": "SEEKING FREELANCE | Egypt | full stack"},
        {"objectID": "3", "comment_text": "Hey! I'm based in Pakistan and freelance"},
    ]}
    [lead] = parse_hn_comments(body)
    assert lead.url == "https://news.ycombinator.com/item?id=1"
    assert lead.title == "Acme (HN Who is hiring)"


def test_parse_ted_and_worldbank_tenders():
    [ted] = parse_ted({"notices": [{"publication-number": "792880-2026", "notice-title": {"eng": "Sweden – Web design"},
                                    "buyer-country": ["SWE"], "buyer-name": {"swe": ["TRANÅS KOMMUN"]},
                                    "deadline-receipt-tender-date-lot": ["2026-12-18+01:00"]}]})
    assert ted.url == "https://ted.europa.eu/en/notice/-/detail/792880-2026"
    assert (ted.kind, ted.country) == ("tender", "SWE")
    assert "TRANÅS KOMMUN" in ted.snippet and "2026-12-18" in ted.snippet

    [wb] = parse_worldbank({"procnotices": [{"id": "OP1", "bid_description": "Digital skills platform",
                                             "project_ctry_name": "Kenya", "submission_deadline_date": "2026-12-05T00:00:00Z"}]})
    assert wb.url.endswith("/procurement-detail/OP1")
    assert (wb.kind, wb.country) == ("tender", "Kenya")
    assert parse_worldbank({"procnotices": {}}) == []


def test_project_candidates_monthly_upsell_link():
    [c] = project_candidates([{"id": "p1", "name": "Acme landing", "platform": "Upwork", "type": "design"}, {"id": "x"}],
                             date(2026, 11, 23))
    assert (c.kind, c.url) == ("upsell", "upsell://project/p1/2026-11")


def test_search_queries_cover_platforms():
    sources = [s for _, s, _ in search_queries(["Figma"])]
    assert sources == ["Upwork (search)", "LinkedIn (search)", "Freelancer.com (search)", "RFP (search)"]


def test_balance_round_robins_sources_and_caps_kinds():
    wwr = [Candidate(title=f"w{i}", url=f"https://w/{i}", source="WWR", kind="lead") for i in range(5)]
    hn = [Candidate(title=f"h{i}", url=f"https://h/{i}", source="HN", kind="lead") for i in range(2)]
    tender = [Candidate(title="t", url="https://t", source="TED", kind="tender")]
    out = balance(wwr + hn + tender, {"lead": 3, "tender": 5})
    assert [c.source for c in out if c.kind == "lead"] == ["WWR", "HN", "WWR"]
    assert sum(c.kind == "tender" for c in out) == 1


def test_profile_text_defaults():
    text = profile_text({})
    assert "semua negara" in text and "tidak ada" in text
    assert "USD 1,000" in profile_text({"minBudgetUsd": 1000})


def test_keywords_tokens_slugs_and_focus():
    from agents.tools.leads import keyword_slugs, keyword_tokens, mark_focus

    assert keyword_tokens("UI/UX") == ["ui", "ux"]
    assert keyword_slugs(["WordPress", "UI/UX", "Framer"]) == ["wordpress", "framer"]
    cands = [
        Candidate(title="Senior UX Designer", url="https://a", source="x"),
        Candidate(title="Backend Go engineer", url="https://b", source="x"),
        Candidate(title="Site build", url="https://c", source="x", snippet="WordPress + Elementor"),
        Candidate(title="Builder of guis", url="https://d", source="x"),
    ]
    assert [c.focus for c in mark_focus(cands, ["WordPress", "UI/UX", "Framer"])] == [True, False, True, False]


def test_balance_puts_focus_first():
    plain = [Candidate(title=f"p{i}", url=f"https://p/{i}", source="WWR", kind="lead") for i in range(3)]
    hit = Candidate(title="wp", url="https://wp", source="HN", kind="lead", focus=True)
    assert [c.title for c in balance([*plain, hit], {"lead": 2})] == ["wp", "p0"]


def test_select_fills_to_limit_with_focus_then_leads_and_caps_sources():
    from agents.crews.sales import TOP_UP_SCORE, Pick, select

    cands = [
        Candidate(title="a", url="https://a", source="Upwork", kind="lead", focus=True),
        Candidate(title="b", url="https://b", source="Upwork", kind="lead", focus=True),
        Candidate(title="c", url="https://c", source="Upwork", kind="lead", focus=True),
        Candidate(title="d", url="https://d", source="TC", kind="funding"),
        Candidate(title="e", url="https://e", source="HN", kind="lead"),
        Candidate(title="f", url="https://f", source="Him", kind="hiring", focus=True),
    ]
    picks = [Pick(i=3, score=70), Pick(i=0, score=90), Pick(i=99, score=99), Pick(i=1, score=0)]
    chosen = select(picks, cands, limit=4, per_source=2)
    assert [(c.title, s) for c, s in chosen] == [("a", 90), ("d", 70), ("b", TOP_UP_SCORE), ("f", TOP_UP_SCORE)]


def test_fallback_item_uses_post_text():
    from agents.crews.sales import fallback_item

    item = fallback_item(Candidate(title="WP fix", url="https://x", source="HN", kind="lead", snippet="Need help"), 40)
    assert (item.type, item.summary, item.score) == ("lead", "Need help", 40)


def test_parse_tavily_drops_articles():
    from agents.tools.leads import parse_tavily

    body = {"results": [
        {"title": "WordPress Developer Needed for One-Page Site - Upwork", "url": "https://upwork.com/1", "content": "x"},
        {"title": "WordPress RFP Template You Can Copy", "url": "https://blog/1"},
        {"title": "How to hire a Framer expert", "url": "https://blog/2"},
    ]}
    assert [c.url for c in parse_tavily(body, "Upwork (search)")] == ["https://upwork.com/1"]
