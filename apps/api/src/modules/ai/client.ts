/** Provider endpoint and credentials; each workspace brings its own key. */
export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** A non-2xx response from the provider; `status` lets callers explain it. */
export class AiProviderError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`AI provider error ${status}: ${detail.slice(0, 300)}`);
    this.name = "AiProviderError";
    this.status = status;
    this.detail = detail;
  }

  /** The key itself was rejected (Gemini answers 400 rather than 401). */
  get isKeyRejected(): boolean {
    return this.status === 401 || this.status === 403 || (this.status === 400 && /api.?key/i.test(this.detail));
  }
}

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

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint via plain fetch.
 * Returns the assistant message and usage; throws when the provider is
 * unreachable/misbehaving (the caller turns that into a friendly reply).
 */
export async function chatWithTools(
  config: AiConfig,
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { temperature?: number } = {},
): Promise<ChatResult> {
  const model = config.model;
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
    response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`AI provider unreachable: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AiProviderError(response.status, detail);
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
