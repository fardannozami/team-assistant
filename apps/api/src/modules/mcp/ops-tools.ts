import { normalizePhoneNumber } from "@repo/shared";
import { audit } from "../auth/index.js";
import { MAX_LOG_LINES, opsLogs, opsRestart, opsServices, opsStatus } from "../ops/service.js";
import type { McpContext, ScopedTool } from "./tools.js";

// Tools for the "ops" agent: the app's own containers on this VPS, nothing else.

const json = (value: unknown) => ({ text: JSON.stringify(value, null, 1) });

function serviceArg(args: Record<string, unknown>): string {
  if (typeof args.service !== "string" || !opsServices().includes(args.service)) {
    throw new Error(`service must be one of: ${opsServices().join(", ")}`);
  }
  return args.service;
}

/** Owners and Admins hear about every restart on WhatsApp. */
async function tellAdmins(workspaceId: string, text: string) {
  const { listEmployees } = await import("../employees/service.js");
  const { sendText } = await import("../whatsapp/service.js");
  const admins = (await listEmployees(workspaceId, { active: true })).filter((e) => e.roleName && ["Owner", "Admin"].includes(e.roleName));
  for (const admin of admins) {
    await sendText(workspaceId, `${normalizePhoneNumber(admin.phone)}@s.whatsapp.net`, text).catch(() => undefined);
  }
}

export const OPS_TOOLS: ScopedTool[] = [
  {
    name: "ops_status",
    scope: "ops:read",
    description: "State of the app's services on the VPS (api, web, worker, agents, naya): running or not, and for how long.",
    inputSchema: { type: "object", properties: {} },
    run: async () => json(await opsStatus()),
  },
  {
    name: "ops_logs",
    scope: "ops:read",
    description: `Recent log lines of one service, with secrets and phone numbers redacted (at most ${MAX_LOG_LINES}).`,
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", enum: opsServices() },
        lines: { type: "number", description: `1-${MAX_LOG_LINES}, default 100` },
      },
      required: ["service"],
    },
    run: async (args) => ({ text: (await opsLogs(serviceArg(args), Number(args.lines) || 100)).join("\n") || "(no log lines)" }),
  },
  {
    name: "ops_restart",
    scope: "ops:restart",
    description: "Restart one service (takes ~10 s). Owners and Admins are told on WhatsApp. Use only when a service is down or stuck.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", enum: opsServices() },
        reason: { type: "string", description: "Why, in one sentence (shown to the admins)." },
      },
      required: ["service", "reason"],
    },
    run: async (args, ctx: McpContext) => {
      const service = serviceArg(args);
      const reason = typeof args.reason === "string" ? args.reason.slice(0, 300) : "";
      const result = await opsRestart(service);
      await audit(ctx.workspaceId, null, "ops.restart", "service", service, { tokenId: ctx.tokenId, reason });
      void tellAdmins(ctx.workspaceId, `⚙️ Agent ops me-restart service *${service}*.\nAlasan: ${reason || "-"}`);
      return json(result);
    },
  },
];
