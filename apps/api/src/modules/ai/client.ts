import { HttpError } from "../../lib/http-error.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type ChatResult = {
  model: string;
  message: ChatMessage;
  usage: ChatUsage | null;
};

function apiBaseUrl(): string {
  const raw = process.env.AI_BASE_URL ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function aiModel(): string {
  return process.env.AI_MODEL ?? DEFAULT_MODEL;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint via plain fetch.
 * Returns the assistant message and usage; throws when the key is missing
 * or the provider is unreachable/misbehaving (the caller turns that into a
 * friendly reply).
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { model?: string; temperature?: number } = {},
): Promise<ChatResult> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new HttpError(400, "AI_API_KEY is not configured");
  }

  const model = opts.model ?? aiModel();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`AI provider unreachable: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AI provider error ${response.status}: ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: ChatMessage }[];
    usage?: ChatUsage;
  };
  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new Error("AI provider returned no assistant message");
  }

  return { model, message, usage: payload.usage ?? null };
}
