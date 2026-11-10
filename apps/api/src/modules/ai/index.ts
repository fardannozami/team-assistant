import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { createDbClient, employees } from "@repo/database";
import { requireRole, getRoleName } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { handleAiMessage } from "./service.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const aiApi = new Hono();

const canChat = requireRole("Owner", "Admin", "Manager", "Employee");

function actorId(c: Context): string | null {
  const user = c.get("user") as { sub?: string } | undefined;
  return user?.sub ?? null;
}

aiApi.post("/chat", canChat, async (c) => {
  const userId = actorId(c);
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
    .where(eq(employees.userId, userId))
    .limit(1);
  if (!employee) {
    throw new HttpError(404, "No employee profile is linked to this account");
  }

  const roleName = await getRoleName(employee.roleId);
  const reply = await handleAiMessage({
    phone: employee.phone,
    body: message.trim(),
    employee,
    roleName,
    channel: "api",
  });

  return c.json({ reply });
});
