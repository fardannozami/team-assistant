"""Request and response shapes shared with apps/api (modules/briefings)."""

from typing import Literal

from pydantic import BaseModel, Field

Audience = Literal["sales", "design", "dev"]
ItemType = Literal["lead", "tender", "funding", "hiring", "upsell", "news"]


class LlmConfig(BaseModel):
    """The workspace's OpenAI-compatible endpoint (workspace_ai_settings, decrypted by the API)."""

    base_url: str = Field(alias="baseUrl")
    api_key: str = Field(alias="apiKey")
    model: str


class RunRequest(BaseModel):
    workspace_id: str = Field(alias="workspaceId")
    audience: Audience
    llm: LlmConfig
    # Agency profile, projects, etc. Free-form so the API can grow it without a deploy here.
    context: dict = Field(default_factory=dict)
    # URLs already sent to this workspace: never offered again.
    seen_urls: list[str] = Field(default_factory=list, alias="seenUrls")
    limit: int = Field(default=5, ge=1, le=20)
    # The workspace's own Tavily key (sales only); no key, no web search.
    search_key: str | None = Field(default=None, alias="searchKey")


class Candidate(BaseModel):
    """A raw item from a feed, before any LLM looks at it."""

    title: str
    url: str
    source: str
    snippet: str = ""
    published: str | None = None
    # What the source is, so the LLM can't relabel a job post as a tender.
    kind: ItemType = "news"
    country: str | None = None
    budget: str | None = None
    # Mentions one of the agency profile's keywords.
    focus: bool = False


class BriefingItem(BaseModel):
    type: ItemType = "news"
    title: str
    url: str
    source: str
    summary: str = Field(description="1-2 kalimat Bahasa Indonesia: apa isinya dan kenapa penting untuk tim")
    score: int = Field(ge=0, le=100, description="Relevansi untuk tim, 0-100")
    country: str | None = None
    budget: str | None = None
    pitch: str | None = None


class BriefingItems(BaseModel):
    items: list[BriefingItem]


class RunResponse(BaseModel):
    audience: Audience
    items: list[BriefingItem]
    candidates: int
    model: str
