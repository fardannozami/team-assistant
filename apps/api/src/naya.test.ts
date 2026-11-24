/**
 * Naya: single sign-on helpers and the MCP endpoint Hermes agents call.
 */
import { describe, expect, test } from "bun:test";
import { createApiTokenSchema } from "@repo/shared";
import { newSecret, safeEqual, sha256Hex } from "./modules/auth/sso.js";
import { handleRpc, type McpTool } from "./modules/mcp/protocol.js";
import { MCP_TOOLS } from "./modules/mcp/tools.js";

describe("sso secrets", () => {
  test("codes are prefixed, url-safe and unique; only their hash is kept", () => {
    const a = newSecret("ta_sso");
    const b = newSecret("ta_sso");
    expect(a).toMatch(/^ta_sso_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  test("secret comparison is exact", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("agent tokens", () => {
  test("names are short and plain; scopes default to read", () => {
    expect(createApiTokenSchema.parse({ name: " sales " })).toEqual({ name: "sales", scopes: ["mcp:read"] });
    expect(createApiTokenSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createApiTokenSchema.safeParse({ name: "a<script>" }).success).toBe(false);
    expect(createApiTokenSchema.safeParse({ name: "sales", scopes: ["mcp:write"] }).success).toBe(false);
  });
});

describe("mcp protocol", () => {
  const echo: McpTool<{ workspaceId: string }> = {
    name: "echo",
    description: "Echo",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    run: async (args, ctx) => ({ text: `${ctx.workspaceId}:${String(args.text)}` }),
  };
  const broken: McpTool<{ workspaceId: string }> = {
    ...echo,
    name: "broken",
    run: async () => {
      throw new Error("boom");
    },
  };
  const ctx = { workspaceId: "ws1" };

  test("initialize agrees on a supported version and announces tools", async () => {
    const reply = (await handleRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      [echo],
      ctx,
    )) as { result: { protocolVersion: string; capabilities: object } };
    expect(reply.result.protocolVersion).toBe("2025-06-18");
    expect(reply.result.capabilities).toEqual({ tools: { listChanged: false } });

    const unknown = (await handleRpc(
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      [echo],
      ctx,
    )) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
  });

  test("notifications get no reply; unknown methods and tools are errors", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, [echo], ctx)).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", id: 3, method: "resources/list" }, [echo], ctx)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Method not found: resources/list" },
    });
    const missing = (await handleRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
      [echo],
      ctx,
    )) as { error: { code: number } };
    expect(missing.error.code).toBe(-32602);
    expect(await handleRpc("garbage", [echo], ctx)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("tools run with the caller's workspace; failures come back as tool errors", async () => {
    expect(
      await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }, [echo], ctx),
    ).toEqual({ jsonrpc: "2.0", id: 5, result: { content: [{ type: "text", text: "ws1:hi" }], isError: false } });
    expect(await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "broken" } }, [broken], ctx)).toEqual({
      jsonrpc: "2.0",
      id: 6,
      result: { content: [{ type: "text", text: "Error: boom" }], isError: true },
    });
  });

  test("daily's tools are read-only and listed with object schemas", async () => {
    const reply = (await handleRpc({ jsonrpc: "2.0", id: 7, method: "tools/list" }, MCP_TOOLS, ctx)) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    expect(reply.result.tools.map((t) => t.name)).toEqual([
      "list_projects",
      "list_team",
      "standup_today",
      "daily_report",
      "weekly_report",
      "idle_members",
      "list_leads",
    ]);
    expect(reply.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  test("dates are validated before any query", async () => {
    const reply = (await handleRpc(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "daily_report", arguments: { date: "kemarin" } } },
      MCP_TOOLS,
      ctx,
    )) as { result: { content: { text: string }[]; isError: boolean } };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toBe("Error: date must be YYYY-MM-DD");
  });
});
