from crewai import LLM

from agents.models import LlmConfig


def build_llm(config: LlmConfig, temperature: float = 0.3) -> LLM:
    """Every provider in apps/api (gemini, groq, openai, openrouter, custom) speaks the OpenAI API,
    so LiteLLM's `openai/` prefix plus the workspace's base URL covers all of them."""
    model = config.model if config.model.startswith("openai/") else f"openai/{config.model}"
    return LLM(model=model, base_url=config.base_url, api_key=config.api_key, temperature=temperature)
