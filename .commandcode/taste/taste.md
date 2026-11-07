# Taste

## Workflow
- Drives feature work through numbered milestones tracked in tasks.md (derived from the PRD), issuing terse continuation commands like "continue M4 — Employee Management"; pick up work at the named milestone and keep its checklist in sync. Confidence: 0.7

## Product design
- Wants operational settings (e.g., standup prompt/reminder schedule times) to be admin-configurable at runtime, with built-in env values kept as defaults/fallback when the admin hasn't set them — not env-file-only. Confidence: 0.6

## Tooling
- When adding MCP servers, chose local scope (project-private config, nothing committed to the repo) over project or user scope. Confidence: 0.6
- For the planned LLM integration, wants a low-budget provider setup — asked to use Google Gemini with a cheap model (flash-lite tier) for the API rather than a premium model. Confidence: 0.6
