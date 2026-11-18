import { getEmployeeStandupHistory } from "../../employees/service.js";
import {
  handleStandupMessage,
  getStandupSession,
  standupToday,
  type StandupCollector,
} from "../../standups/engine.js";
import { resolveTargetEmployee } from "./lookup.js";
import { formatEmployee, type ToolHandler } from "./shared.js";

export const SELF_TOOLS: Record<string, ToolHandler> = {
  async get_employee(args, ctx) {
    const target = await resolveTargetEmployee(args, ctx);
    if (!target.ok) return target;
    return formatEmployee(target.employee);
  },

  async get_standup_history(args, ctx) {
    const target = await resolveTargetEmployee(args, ctx);
    if (!target.ok) return target;
    if (!target.employee) return { ok: false, error: "Employee not found." };

    const requested = Number.parseInt(String(args?.limit ?? ""), 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 20) : 5;
    const { standups: history } = await getEmployeeStandupHistory(
      ctx.workspaceId,
      target.employee.id,
    );
    if (history.length === 0) {
      return { ok: true, data: "No recorded standups yet." };
    }
    return {
      ok: true,
      data: history
        .slice(0, limit)
        .map(
          (s) =>
            `- ${s.date}: yesterday="${s.answers.yesterday ?? "-"}", today="${s.answers.today ?? "-"}", blockers="${s.answers.blockers ?? "-"}"`,
        )
        .join("\n"),
    };
  },

  async create_standup(args, ctx) {
    if (args?.identifier || args?.employeeId || args?.phone) {
      return { ok: false, error: "Standups can only be saved for yourself." };
    }
    if (!ctx.employee.isActive) {
      return { ok: false, error: "Only active employees can send standups." };
    }

    const yesterday = String(args?.yesterday ?? "").trim();
    const today = String(args?.today ?? "").trim();
    const blockers = String(args?.blockers ?? "").trim();
    const missing = [
      ["yesterday", yesterday],
      ["today", today],
      ["blockers", blockers],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Missing answer(s): ${missing.join(", ")}. Ask the user for them.`,
      };
    }

    // STANDUP opens today's session on demand, like the WhatsApp keyword.
    const composed = `STANDUP Yesterday: ${yesterday}. Today: ${today}. Blockers: ${blockers}`;
    const collector: StandupCollector = {
      id: ctx.employee.id,
      workspaceId: ctx.workspaceId,
      name: ctx.employee.name,
      phone: ctx.employee.phone,
      isActive: ctx.employee.isActive,
    };
    const reply = await handleStandupMessage({ employee: collector, body: composed });
    if (reply) return { ok: true, data: reply };

    const session = await getStandupSession(
      ctx.employee.id,
      await standupToday(ctx.workspaceId),
    );
    if (!session) {
      return {
        ok: false,
        error:
          "There is no open standup session for today yet. An admin needs to start the standup first.",
      };
    }
    if (session.status === "completed") {
      return {
        ok: false,
        error: "Today's standup was already completed. Nothing to save.",
      };
    }
    return { ok: false, error: "The standup answers could not be saved." };
  },
};
