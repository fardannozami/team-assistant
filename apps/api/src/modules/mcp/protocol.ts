// A minimal MCP server over Streamable HTTP in stateless JSON mode: every
// POST carries one JSON-RPC message (or a batch) and gets JSON back. Enough
// for tools; no sessions, SSE streams, resources or prompts.

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "daily-digdaya", version: "1.0.0" };

export type ToolResult = { text: string; isError?: boolean };

export type McpTool<Ctx> = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<ToolResult>;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: unknown; params?: unknown };

const result = (id: JsonRpcId, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Handles one message; returns null for notifications (no reply). */
export async function handleRpc<Ctx>(
  message: unknown,
  tools: McpTool<Ctx>[],
  ctx: Ctx,
  instructions?: string,
): Promise<object | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return failure(null, -32600, "Invalid Request");
  const { id, method, params } = message as JsonRpcRequest;
  if (typeof method !== "string") return failure(id ?? null, -32600, "Invalid Request");
  if (id === undefined) return null; // notifications/initialized, cancelled, …
  const args = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      const requested = typeof args.protocolVersion === "string" ? args.protocolVersion : "";
      return result(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        ...(instructions ? { instructions } : {}),
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === args.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(args.name)}`);
      const input = (args.arguments && typeof args.arguments === "object" ? args.arguments : {}) as Record<string, unknown>;
      try {
        const out = await tool.run(input, ctx);
        return result(id, { content: [{ type: "text", text: out.text }], isError: Boolean(out.isError) });
      } catch (err) {
        // Tool failures go back to the model as a result, not a protocol error.
        return result(id, { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}
