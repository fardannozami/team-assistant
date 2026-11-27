/**
 * Naya: single sign-on helpers and the MCP endpoint Hermes agents call.
 */
import { describe, expect, test } from "bun:test";
import { createApiTokenSchema } from "@repo/shared";
import { newSecret, safeEqual, sha256Hex } from "./modules/auth/login-links.js";
import { handleRpc, type McpTool } from "./modules/mcp/protocol.js";
import { READ_TOOLS } from "./modules/mcp/tools.js";
import { OPS_TOOLS } from "./modules/mcp/ops-tools.js";
import { demuxLogs, opsServices, opsStatus, redactSecrets } from "./modules/ops/service.js";
import { nayaPermissions, type NayaAgent } from "./modules/naya/agents.js";
import { chatEndpoint, relayStream } from "./modules/naya/chat.js";
import { isNayaKeyword } from "./modules/naya/login.js";
import { offNightShift, splitTasks, teamPresence, teamTasks, withOwnTasks } from "./modules/naya/team.js";

describe("sign-in link secrets", () => {
  test("codes are prefixed, url-safe and unique; only their hash is kept", () => {
    const a = newSecret("ta_login");
    const b = newSecret("ta_login");
    expect(a).toMatch(/^ta_login_[A-Za-z0-9_-]{32}$/);
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

describe("whatsapp sign-in link", () => {
  test("only the bare keyword asks for a link", () => {
    expect(isNayaKeyword("NAYA")).toBe(true);
    expect(isNayaKeyword("  naya ")).toBe(true);
    expect(isNayaKeyword("naya tolong carikan leads")).toBe(false);
    expect(isNayaKeyword("")).toBe(false);
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
  const echo: McpTool<{ workspaceId: string; tokenId: string; scopes: string[] }> = {
    name: "echo",
    description: "Echo",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    run: async (args, ctx) => ({ text: `${ctx.workspaceId}:${String(args.text)}` }),
  };
  const broken: McpTool<{ workspaceId: string; tokenId: string; scopes: string[] }> = {
    ...echo,
    name: "broken",
    run: async () => {
      throw new Error("boom");
    },
  };
  const ctx = { workspaceId: "ws1", tokenId: "t1", scopes: ["mcp:read"] };

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
    const reply = (await handleRpc({ jsonrpc: "2.0", id: 7, method: "tools/list" }, READ_TOOLS, ctx)) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    expect(reply.result.tools.map((t) => t.name)).toEqual([
      "list_projects",
      "list_team",
      "standup_today",
      "daily_report",
      "weekly_report",
      "idle_members",
    ]);
    expect(reply.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  test("dates are validated before any query", async () => {
    const reply = (await handleRpc(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "daily_report", arguments: { date: "kemarin" } } },
      READ_TOOLS,
      ctx,
    )) as { result: { content: { text: string }[]; isError: boolean } };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toBe("Error: date must be YYYY-MM-DD");
  });
});

describe("ops", () => {
  test("only whitelisted service names count", () => {
    expect(opsServices({ OPS_SERVICES: "api, web ,Bad Name,../x,worker" })).toEqual(["api", "web", "worker"]);
    expect(OPS_TOOLS.map((t) => [t.name, t.scope])).toEqual([
      ["ops_status", "ops:read"],
      ["ops_logs", "ops:read"],
      ["ops_restart", "ops:restart"],
    ]);
  });

  test("log lines lose secrets, credentials in URLs, JWTs and phone numbers", () => {
    const line =
      "connect postgres://ta:s3cretpw@postgres:5432/db key=AIzaSyA1234567890abcdefghijklmn token=abc123 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlZm9v from 081229822979";
    const clean = redactSecrets(line);
    for (const secret of ["s3cretpw", "AIzaSyA1234567890", "abc123", "eyJhbGciOiJIUzI1NiJ9", "081229822979"]) {
      expect(clean).not.toContain(secret);
    }
    expect(clean).toContain("postgres://ta:[redacted]@postgres:5432/db");
  });

  test("docker's multiplexed log frames are joined; TTY logs pass through", () => {
    const frame = (stream: number, text: string) => {
      const body = new TextEncoder().encode(text);
      const header = new Uint8Array(8);
      header[0] = stream;
      new DataView(header.buffer).setUint32(4, body.length);
      return [...header, ...body];
    };
    expect(demuxLogs(new Uint8Array([...frame(1, "line one\n"), ...frame(2, "line two\n")]))).toBe("line one\nline two\n");
    expect(demuxLogs(new TextEncoder().encode("plain tty log\n"))).toBe("plain tty log\n");
  });

  test("status lists only the whitelisted services of the project", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json([
        { Id: "1", Names: ["/x-api-1"], State: "running", Status: "Up 2 hours", Image: "ghcr.io/o/team-assistant-api:abc", Labels: { "com.docker.compose.service": "api", "com.docker.compose.project": "ta" } },
        { Id: "2", Names: ["/x-postgres-1"], State: "running", Status: "Up", Image: "postgres:16", Labels: { "com.docker.compose.service": "postgres", "com.docker.compose.project": "ta" } },
        { Id: "3", Names: ["/other-api-1"], State: "exited", Status: "Exited", Image: "x", Labels: { "com.docker.compose.service": "api", "com.docker.compose.project": "other" } },
      ])) as unknown as typeof fetch;
    try {
      expect(await opsStatus({ DOCKER_PROXY_URL: "http://proxy:2375", OPS_SERVICES: "api,web", OPS_COMPOSE_PROJECT: "ta" } as NodeJS.ProcessEnv)).toEqual([
        { service: "api", state: "running", status: "Up 2 hours", image: "team-assistant-api:abc" },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("naya permissions", () => {
  const agent = (profile: string, chatRoles: string[], hasKey = true): NayaAgent => ({
    profile,
    displayName: profile,
    description: null,
    chatRoles,
    isLead: profile === "naya",
    hasKey,
    apiKeyHint: hasKey ? "abcd" : null,
  });
  const agents = [agent("naya", ["Owner", "Admin"]), agent("sales", ["Owner", "Admin", "PM"]), agent("nokey", ["PM"], false)];

  test("roles decide instructing, reviewing, commenting and chatting", () => {
    expect(nayaPermissions("PM", agents)).toMatchObject({ instruct: true, review: true, comment: true, manageAgents: false, chat: ["sales"] });
    expect(nayaPermissions("Manager", agents)).toMatchObject({ instruct: false, review: true, comment: true, chat: [] });
    expect(nayaPermissions("Employee", agents)).toMatchObject({ instruct: false, review: false, comment: true, see: { allTasks: false, agents: false, calendar: false, usage: false } });
    expect(nayaPermissions("PM", agents).see).toEqual({ allTasks: true, agents: true, calendar: true, usage: true });
    expect(nayaPermissions("Owner", agents)).toMatchObject({ manageAgents: true, chat: ["naya", "sales"] });
    expect(nayaPermissions(null, agents)).toMatchObject({ instruct: false, review: false, comment: false, chat: [] });
  });
});

describe("naya chat", () => {
  test("profiles share one Hermes listener", () => {
    const previous = process.env.HERMES_API_URL;
    process.env.HERMES_API_URL = "http://hermes:8642/";
    try {
      expect(chatEndpoint("default")).toBe("http://hermes:8642/v1");
      expect(chatEndpoint("sales")).toBe("http://hermes:8642/p/sales/v1");
    } finally {
      if (previous === undefined) delete process.env.HERMES_API_URL;
      else process.env.HERMES_API_URL = previous;
    }
  });

  test("answer text and tool progress pass on; reasoning and secrets stay out", async () => {
    const sse = [
      ": keepalive",
      'data: {"choices":[{"delta":{"reasoning_content":"thinking…"}}]}',
      "",
      "event: hermes.tool.progress",
      'data: {"emoji":"🔎","label":"web_search key sk-abcdefghijklmnopqrstuv"}',
      "",
      'data: {"choices":[{"delta":{"content":"Halo "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"Fardan"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const events: [string, Record<string, unknown>][] = [];
    await relayStream(body, (event, data) => {
      events.push([event, data]);
    });
    expect(events.map(([event]) => event)).toEqual(["tool", "delta", "delta"]);
    expect(String(events[0]![1].label)).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(events.slice(1).map(([, data]) => data.text).join("")).toBe("Halo Fardan");
  });
});

describe("naya attachments", () => {
  test("files stream through from the bridge; refusals keep their status", async () => {
    const { bridge } = await import("./modules/naya/bridge.js");
    const original = globalThis.fetch;
    const env = { url: process.env.HERMES_BRIDGE_URL, token: process.env.BRIDGE_TOKEN };
    process.env.HERMES_BRIDGE_URL = "http://hermes:8700";
    process.env.BRIDGE_TOKEN = "bridge-token-for-tests";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      if (String(url).endsWith("/2")) return new Response(JSON.stringify({ error: "Lampiran di luar folder Hermes." }), { status: 403 });
      if (String(url).endsWith("/3")) return new Response(JSON.stringify({ error: "Lampiran terlalu besar" }), { status: 413 });
      return new Response("1. Indofood\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }) as unknown as typeof fetch;
    try {
      const file = await bridge.attachment("t_3a25786b", "1", "sales");
      expect(await file.text()).toBe("1. Indofood\n");
      expect(seen[0]).toBe("http://hermes:8700/tasks/t_3a25786b/attachments/1?board=sales");
      await expect(bridge.attachment("t_3a25786b", "2")).rejects.toMatchObject({ status: 403 });
      await expect(bridge.attachment("t_3a25786b", "3")).rejects.toMatchObject({ status: 400 });
    } finally {
      globalThis.fetch = original;
      process.env.HERMES_BRIDGE_URL = env.url;
      process.env.BRIDGE_TOKEN = env.token;
      if (env.url === undefined) delete process.env.HERMES_BRIDGE_URL;
      if (env.token === undefined) delete process.env.BRIDGE_TOKEN;
    }
  });
});

describe("team avatars from today's standup", () => {
  test("a plan splits into one card per line, bullet or number", () => {
    expect(splitTasks("Hari ini:\n- Fix login\n- Review PR #12")).toEqual(["Fix login", "Review PR #12"]);
    expect(splitTasks("1. Invoice export 2. Deploy staging")).toEqual(["Invoice export", "Deploy staging"]);
    expect(splitTasks("Slicing dashboard; meeting klien")).toEqual(["Slicing dashboard", "meeting klien"]);
    expect(splitTasks("")).toEqual([]);
  });

  test("without allTasks, colleagues keep their avatar but not their plan", () => {
    const task = { title: "Fix login", status: "doing" as const };
    const member = (id: string) => ({ id, name: id, team: null, shift: "day", date: "2026-11-26", presence: "working" as const, offShift: false, tasks: [task] });
    const seen = withOwnTasks([member("me"), member("other")], "me");
    expect(seen.map((m) => [m.id, m.presence, m.tasks.length])).toEqual([["me", "working", 1], ["other", "working", 0]]);
    expect(withOwnTasks([member("other")], null)[0]!.tasks).toEqual([]);
  });

  test("exploration or standby only means santai; any real task means working", () => {
    expect(teamPresence(undefined, { today: "Standby" })).toBe("standby");
    expect(teamPresence(undefined, { today: "- Eksplorasi Three.js\n- stand by nunggu klien" })).toBe("standby");
    expect(teamPresence(undefined, { today: "Belum ada task" })).toBe("standby");
    expect(teamPresence(undefined, { today: "- Fix invoice bug\n- explore chart libs" })).toBe("working");
    expect(teamPresence(undefined, {})).toBe("absent");
  });

  test("checking out (or missing it) ends the shift", () => {
    expect(teamPresence({ checkoutStatus: "completed" }, { today: "Fix login" })).toBe("resting");
    expect(teamPresence({ checkoutStatus: "missed" }, { today: "Fix login" })).toBe("resting");
    expect(teamPresence({ checkoutStatus: "pending" }, { today: "Fix login" })).toBe("working");
  });

  test("the night shift is off between its checkout and its standup", () => {
    // Asia/Jakarta is UTC+7.
    const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 27, hour - 7, minute));
    expect(offNightShift("night", "Asia/Jakarta", at(14))).toBe(true);
    expect(offNightShift("night", "Asia/Jakarta", at(7))).toBe(true);
    expect(offNightShift("night", "Asia/Jakarta", at(6, 59))).toBe(false);
    expect(offNightShift("night", "Asia/Jakarta", at(19))).toBe(false);
    expect(offNightShift("night", "Asia/Jakarta", at(23))).toBe(false);
    expect(offNightShift("day", "Asia/Jakarta", at(14))).toBe(false);
  });

  test("the kanban moves done work and adds blockers at checkout", () => {
    const answers = { today: "- Fix login\n- Invoice export", done: "- Fix login", blockers: "Menunggu akses server" };
    expect(teamTasks(answers, false)).toEqual([
      { title: "Fix login", status: "doing" },
      { title: "Invoice export", status: "doing" },
      { title: "Menunggu akses server", status: "blocked" },
    ]);
    expect(teamTasks({ ...answers, blockers: "tidak ada kendala" }, true)).toEqual([
      { title: "Invoice export", status: "doing" },
      { title: "Fix login", status: "done" },
    ]);
  });
});
