from agents.crews.news import keep_known
from agents.models import BriefingItem, Candidate
from agents.tools.feeds import clean, dedupe, parse_feed, parse_hn

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel><title>Smashing</title>
<item><title>Designing &amp; Testing Forms</title><link>https://example.com/forms</link>
<description>&lt;p&gt;Forms are   <b>hard</b>.&lt;/p&gt;</description><pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate></item>
<item><title></title><link>https://example.com/no-title</link></item>
<item><title>Color in Dark Mode</title><link>https://example.com/dark</link></item>
</channel></rss>"""


def test_parse_feed_skips_untitled_and_cleans_html():
    items = parse_feed("Smashing", RSS)
    assert [i.url for i in items] == ["https://example.com/forms", "https://example.com/dark"]
    assert items[0].title == "Designing & Testing Forms"
    assert items[0].snippet == "Forms are hard ."
    assert items[0].source == "Smashing"


def test_parse_hn_falls_back_to_discussion_link():
    items = parse_hn(
        {
            "hits": [
                {"title": "Bun 2.0", "url": "https://bun.sh/blog", "points": 900, "num_comments": 300},
                {"title": "Ask HN: tools?", "url": None, "objectID": "42"},
                {"title": None},
            ]
        }
    )
    assert [i.url for i in items] == ["https://bun.sh/blog", "https://news.ycombinator.com/item?id=42"]
    assert items[0].snippet == "900 points, 300 comments"


def test_clean_truncates():
    assert clean("a" * 300, 10) == "a" * 9 + "…"


def test_dedupe_drops_seen_and_repeats():
    a = Candidate(title="A", url="https://a", source="x")
    b = Candidate(title="B", url="https://b", source="x")
    assert dedupe([a, b, a], {"https://b"}) == [a]


def test_keep_known_drops_invented_urls_and_sorts():
    cands = [Candidate(title="A", url="https://a", source="Feed A"), Candidate(title="B", url="https://b", source="Feed B")]
    items = [
        BriefingItem(title="B", url="https://b", source="wrong", summary="s", score=40),
        BriefingItem(title="Fake", url="https://made-up", source="x", summary="s", score=99),
        BriefingItem(title="A", url="https://a", source="Feed A", summary="s", score=80),
        BriefingItem(title="A again", url="https://a", source="Feed A", summary="s", score=70),
    ]
    out = keep_known(items, cands, limit=5)
    assert [i.url for i in out] == ["https://a", "https://b"]
    assert out[1].source == "Feed B"


def test_release_titles_name_the_project():
    atom = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>v4.13.18</title><link href="https://github.com/honojs/hono/releases/tag/v4.13.18"/></entry>
<entry><title>Hono v5 beta</title><link href="https://github.com/honojs/hono/releases/tag/v5"/></entry>
</feed>"""
    assert [i.title for i in parse_feed("Hono releases", atom)] == ["Hono v4.13.18", "Hono v5 beta"]


def test_keep_known_caps_items_per_source():
    cands = [Candidate(title=str(i), url=f"https://j/{i}", source="Jobicy") for i in range(3)]
    cands.append(Candidate(title="t", url="https://t", source="TED"))
    items = [BriefingItem(title=c.title, url=c.url, source="x", summary="s", score=90 - i) for i, c in enumerate(cands)]
    out = keep_known(items, cands, limit=5, per_source=2)
    assert [i.url for i in out] == ["https://j/0", "https://j/1", "https://t"]
