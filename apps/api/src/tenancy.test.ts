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

  test("AI keys are per workspace, encrypted, and never returned", async () => {
    const { encryptSecret } = await import("./lib/secrets.js");
    const { resolveAiConfig } = await import("./modules/ai/settings.js");
    const stored = await encryptSecret("sk-test-secret-a1b2");
    expect(stored).not.toContain("sk-test");
    await db.insert(schema.workspaceAiSettings).values({
      workspaceId: ws.a.id,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: stored,
      apiKeyHint: "a1b2",
    });

    const a = await (await req("a", "/ai/settings")).json();
    expect(a.configured).toBe(true);
    expect(a.apiKeyHint).toBe("a1b2");
    expect(JSON.stringify(a)).not.toContain("sk-test");
    expect((await (await req("b", "/ai/settings")).json()).configured).toBe(false);

    expect((await resolveAiConfig(ws.a.id))?.apiKey).toBe("sk-test-secret-a1b2");
    expect(await resolveAiConfig(ws.b.id)).toBeNull();

    // B can't reuse A's stored key, and custom endpoints must be public https.
    const keyless = await req("b", "/ai/settings", { method: "PUT", body: JSON.stringify({ provider: "openai" }) });
    expect(keyless.status).toBe(400);
    const local = await req("a", "/ai/settings", {
      method: "PUT",
      body: JSON.stringify({ provider: "custom", baseUrl: "http://localhost:4000", apiKey: "x" }),
    });
    expect(local.status).toBe(400);

    expect((await req("b", "/ai/settings", { method: "DELETE" })).status).toBe(200);
    expect(await resolveAiConfig(ws.a.id)).not.toBeNull();
  });

  test("admin chat tools resolve, confirm and act only within the workspace", async () => {
    const { prepareTool, executeTool } = await import("./modules/ai/tools.js");
    const { getEmployee } = await import("./modules/employees/service.js");
    const self = (await getEmployee(ws.a.id, ws.a.employeeId))!;
    const admin = { workspaceId: ws.a.id, employee: self as any, roleName: "Admin", actorId: null };
    const member = { ...admin, roleName: "Employee" };
    const run = async (name: string, args: Record<string, unknown>) => {
      const prepared = await prepareTool(name, args, admin);
      if (!prepared?.ok) throw new Error(`${name}: ${prepared ? prepared.error : "not prepared"}`);
      return { prepared, result: await executeTool(name, prepared.args, admin) };
    };

    expect(await prepareTool("add_employee", { name: "X", phone: "08123456789" }, member)).toEqual({
      ok: false,
      error: "Hanya Owner atau Admin yang bisa melakukan ini.",
    });
    // Workspace B's employee is invisible to A.
    expect((await prepareTool("update_employee_phone", { identifier: "Emp b", phone: "0811111111" }, admin))?.ok).toBe(false);

    const added = await run("add_employee", { name: "Budi Chat", phone: "0812 3333 4444" });
    expect(added.prepared.summary).toContain("6281233334444");
    expect(added.result.ok).toBe(true);

    const phone = await run("update_employee_phone", { identifier: "budi", phone: "0857-1111-2222" });
    expect(phone.result.data).toContain("6285711112222");

    await run("create_team", { name: "Tim Chat" });
    const moved = await run("update_employee", { identifier: "Budi Chat", team: "tim chat", role: "Manager" });
    expect(moved.result.data).toContain("Tim Chat");
    expect(moved.result.data).toContain("Manager");
    expect((await prepareTool("delete_team", { team: "Tim Chat" }, admin))?.ok).toBe(false);

    await run("set_employee_active", { identifier: "Budi Chat", active: false });
    expect((await prepareTool("set_employee_active", { identifier: self.name, active: false }, admin))?.ok).toBe(false);

    const list = await executeTool("list_employees", { status: "all" }, admin);
    expect(list.data).toContain("Budi Chat");
    expect(list.data).toContain("nonaktif");
    expect(list.data).not.toContain("Emp b");

    await run("add_calendar_exception", { date: "2030-01-02", reason: "Outing" });
    expect((await executeTool("list_holidays", {}, admin)).data).toContain("2030-01-02");
    await run("delete_calendar_exception", { date: "2030-01-02" });

    const standup = await run("start_standup", {});
    expect(standup.result.data).toContain("belum terhubung");
  });

  test("employee standup keywords; other messages are left for the AI", async () => {
    const { handleStandupMessage } = await import("./modules/standups/engine.js");
    const { getEmployee } = await import("./modules/employees/service.js");
    const employee = { ...(await getEmployee(ws.b.id, ws.b.employeeId))!, workspaceId: ws.b.id };
    const say = (body: string) => handleStandupMessage({ employee, body, date: "2030-02-01" });

    expect(await say("ganti nomor Wil sekarang")).toBeNull();
    expect(await say("BANTUAN")).toContain("UBAH STANDUP");
    expect(await say("UBAH STANDUP kendala: x")).toContain("Kirim STANDUP");

    expect(await say("STANDUP")).toContain("Apa yang kamu kerjakan kemarin?");
    expect(await say("bikin halaman login")).toContain("Diterima kemarin");
    expect(await say("hari ini: integrasi API. kendala: tidak ada")).toContain("Standup tercatat");

    // Completed: free text (even with words like "sekarang"/"masalah") is not an edit.
    expect(await say("tolong cek masalah server sekarang")).toBeNull();
    expect(await say("STANDUP")).toContain("sudah tercatat");
    const edited = await say("ubah standup kendala: menunggu akses server");
    expect(edited).toContain("Kendala: menunggu akses server");
    expect(edited).toContain("Hari ini: integrasi API");
  });

  test("whatsapp status is per workspace and requires auth", async () => {
    expect((await app.request("/whatsapp/status")).status).toBe(401);
    const status = await (await req("a", "/whatsapp/status")).json();
    expect(status.connected).toBe(false);
  });
});
