import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDbClient, employees } from "@repo/database";
import { requireRole, getRoleName } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { handleAiMessage } from "./service.js";
import { deleteAiSettings, getAiSettings, saveAiSettings, type SaveAiSettingsInput } from "./settings.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const aiApi = new Hono();

const canChat = requireRole("Owner", "Admin", "Manager", "Employee");

aiApi.post("/chat", canChat, async (c) => {
  const ws = getWorkspaceId(c);
  const userId = getActorId(c);
  const { message } = await c.req.json<{ message?: string }>();
  if (!message?.trim()) {
    throw new HttpError(400, "message is required");
  }
  if (!userId) {
    throw new HttpError(401, "Unauthorized");
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.userId, userId), eq(employees.workspaceId, ws)))
    .limit(1);
  if (!employee) {
    throw new HttpError(404, "No employee profile is linked to this account");
  }

  const roleName = await getRoleName(employee.roleId);
  const reply = await handleAiMessage({
    workspaceId: ws,
    phone: employee.phone,
    body: message.trim(),
    employee,
    roleName,
    channel: "api",
  });

  return c.json({ reply });
});

const canManage = requireRole("Owner", "Admin");

aiApi.get("/settings", canManage, async (c) => c.json(await getAiSettings(getWorkspaceId(c))));

aiApi.put("/settings", canManage, async (c) => {
  const input = await c.req.json<SaveAiSettingsInput>();
  return c.json(await saveAiSettings(getWorkspaceId(c), input, getActorId(c)));
});

aiApi.delete("/settings", canManage, async (c) => c.json(await deleteAiSettings(getWorkspaceId(c), getActorId(c))));
