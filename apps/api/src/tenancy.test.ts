/**
 * Tenant isolation: two workspaces with overlapping employee phones must never
 * see or change each other's data. Needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/tenancy.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("tenant isolation", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  const ws: Record<"a" | "b", { id: string; token: string; employeeId: string; scheduleId: string }> = {} as any;
  const phone = "6281200000001";

  const req = (who: "a" | "b", path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${ws[who].token}`, ...init.headers },
    });

  beforeAll(async () => {
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    const { sign } = await import("hono/jwt");
    const { eq } = await import("drizzle-orm");

    for (const name of ["Owner", "Admin", "Manager", "Employee"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const [owner] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Owner"));

    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `Tenancy test ${who}` });
      const [user] = await db
        .insert(schema.users)
        .values({ workspaceId: workspace.id, email: `tenancy-${who}-${workspace.id}@test.local`, name: who, roleId: owner.id })
        .returning();
      const token = await sign({ sub: user.id, role: "Owner", workspaceId: workspace.id }, process.env.JWT_SECRET ?? "dev-secret-change-me");
      ws[who] = { id: workspace.id, token, employeeId: "", scheduleId: "" };

      const created = await req(who, "/employees", { method: "POST", body: JSON.stringify({ name: `Emp ${who}`, phone }) });
      expect(created.status).toBe(201);
      ws[who].employeeId = (await created.json()).id;
      const [schedule] = await db.select().from(schema.schedules).where(eq(schema.schedules.workspaceId, workspace.id));
      ws[who].scheduleId = schedule.id;
    }
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  test("same phone can exist in both workspaces, list shows only own", async () => {
    for (const who of ["a", "b"] as const) {
      const { employees } = await (await req(who, "/employees")).json();
      expect(employees.map((e: { id: string }) => e.id)).toEqual([ws[who].employeeId]);
    }
  });

  test("cannot read or modify another workspace's employee by id", async () => {
    expect((await req("a", `/employees/${ws.b.employeeId}`)).status).toBe(404);
    expect((await req("a", `/employees/${ws.b.employeeId}`, { method: "PATCH", body: JSON.stringify({ name: "hijack" }) })).status).toBe(404);
    expect((await req("a", `/employees/${ws.b.employeeId}/phone`, { method: "PATCH", body: JSON.stringify({ phone: "6281299999999" }) })).status).toBe(404);
  });

  test("cannot read, change or trigger another workspace's schedule", async () => {
    expect((await req("a", `/schedules/${ws.b.scheduleId}`)).status).toBe(404);
    expect((await req("a", `/schedules/${ws.b.scheduleId}`, { method: "PATCH", body: JSON.stringify({ timeOfDay: "03:00" }) })).status).toBe(404);
    expect((await req("a", `/schedules/${ws.b.scheduleId}/trigger`, { method: "POST" })).status).toBe(404);
    const { schedules } = await (await req("a", "/schedules")).json();
    expect(schedules.map((s: { id: string }) => s.id)).toEqual([ws.a.scheduleId]);
  });

  test("daily report counts only own members", async () => {
    const report = await (await req("a", "/reports/daily")).json();
    expect(report.total).toBe(1);
  });

  test("inbound phone lookup resolves within the receiving bot's workspace", async () => {
    const { getEmployeeByPhone } = await import("./modules/auth/index.js");
    expect((await getEmployeeByPhone(ws.a.id, phone))?.id).toBe(ws.a.employeeId);
    expect((await getEmployeeByPhone(ws.b.id, `0${phone.slice(2)}`))?.id).toBe(ws.b.employeeId);
  });

  test("internal calls must name a known workspace", async () => {
    const internal = { "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "dev-internal-token" };
    expect((await app.request("/standups/trigger", { method: "POST", headers: internal })).status).toBe(400);
    expect(
      (await app.request("/standups/trigger", { method: "POST", headers: { ...internal, "x-workspace-id": crypto.randomUUID() } })).status,
    ).toBe(400);
  });

  test("whatsapp status is per workspace and requires auth", async () => {
    expect((await app.request("/whatsapp/status")).status).toBe(401);
    const status = await (await req("a", "/whatsapp/status")).json();
    expect(status.connected).toBe(false);
  });
});
