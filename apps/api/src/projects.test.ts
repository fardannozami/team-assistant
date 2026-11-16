/**
 * Projects & fee splits (PM role): the fee math of the project sheet,
 * validation, PM-only access to projects and workspace isolation.
 * The DB part needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/projects.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { projectInputSchema } from "@repo/shared";
import { projectFees, splitFees } from "./modules/projects/service.js";

describe("project fee math", () => {
  test("split fee is the fee received minus the platform cut", () => {
    // The platform's 10% comes off the fee received; the rest is split.
    const hourly = projectFees({ feeReceived: 75, platformFeePercent: 10, totalFee: null });
    expect(hourly).toMatchObject({ platformFee: 7.5, splitBase: 67.5 });
    expect([20, 80, 50].map(hourly.memberFee)).toEqual([13.5, 54, 33.75]);

    // An explicit total fee overrides the automatic one.
    const fixed = projectFees({ feeReceived: 250, platformFeePercent: 10, totalFee: 225 });
    expect(fixed).toMatchObject({ platformFee: 25, splitBase: 225 });
    expect([25, 50].map(fixed.memberFee)).toEqual([56.25, 112.5]);

    // An explicit total fee is what gets split.
    expect(projectFees({ feeReceived: 100, platformFeePercent: 20, totalFee: 80 }).memberFee(50)).toBe(40);
  });

  test("shares at 100% add up to the split base to the cent", () => {
    expect(splitFees(100, [33.33, 33.33, 33.34].map((sharePercent) => ({ sharePercent })))).toEqual([33.33, 33.33, 33.34]);
    const odd = splitFees(10, [33.33, 33.33, 33.33, 0.01].map((sharePercent) => ({ sharePercent })));
    expect(Math.round(odd.reduce((s, f) => s + f, 0) * 100)).toBe(1000);
    // PM 50%, designers splitting the other half.
    expect(splitFees(67.5, [50, 10, 40].map((sharePercent) => ({ sharePercent })))).toEqual([33.75, 6.75, 27]);
  });

  test("validation: total share, duplicates and dates", () => {
    const base = {
      platform: "Upwork",
      name: "X",
      status: "ongoing",
      paymentType: "fixed",
      feeReceived: 100,
      paymentStatus: "pending",
    };
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    const ok = projectInputSchema.safeParse({
      ...base,
      members: [
        { employeeId: a, role: "pm_sales", sharePercent: 25 },
        { employeeId: b, role: "pm_sales", sharePercent: 25 },
        // Same person may be PM and designer.
        { employeeId: a, role: "designer", sharePercent: 30 },
        { employeeId: b, role: "developer", sharePercent: 20 },
      ],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ currency: "USD", platformFeePercent: 10 });

    const over = projectInputSchema.safeParse({
      ...base,
      members: [
        { employeeId: a, role: "pm_sales", sharePercent: 50 },
        { employeeId: b, role: "designer", sharePercent: 50.01 },
      ],
    });
    expect(over.success).toBe(false);

    const dup = projectInputSchema.safeParse({
      ...base,
      members: [
        { employeeId: a, role: "designer", sharePercent: 10 },
        { employeeId: a, role: "designer", sharePercent: 10 },
      ],
    });
    expect(dup.success).toBe(false);

    expect(projectInputSchema.safeParse({ ...base, members: [], startDate: "2026-02-10", endDate: "2026-02-01" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...base, members: [], totalFee: 100.01 }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...base, members: [], totalFee: 100 }).success).toBe(true);
  });
});

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("projects api", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  const ws: Record<"a" | "b", { id: string; owner: string; pm: string; manager: string }> = {} as any;
  const people: Record<string, string> = {};
  const suffix = Date.now().toString(36);

  const req = (token: string, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
    });

  beforeAll(async () => {
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    const { sign } = await import("hono/jwt");

    for (const name of ["Owner", "Admin", "Manager", "Employee", "PM"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const roleIds = Object.fromEntries((await db.select().from(schema.roles)).map((r: any) => [r.name, r.id]));
    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `Project test ${who}` });
      const tokens: Record<string, string> = {};
      for (const role of ["Owner", "PM", "Manager"]) {
        const [user] = await db
          .insert(schema.users)
          .values({ workspaceId: workspace.id, email: `${role}-${who}-${suffix}@project.test`, name: role, roleId: roleIds[role] })
          .returning();
        tokens[role] = await sign({ sub: user.id, role, workspaceId: workspace.id }, process.env.JWT_SECRET ?? "dev-secret-change-me");
      }
      ws[who] = { id: workspace.id, owner: tokens.Owner!, pm: tokens.PM!, manager: tokens.Manager! };
    }
    for (const [name, phone] of [["Nanda", "6281277770001"], ["Zainal", "6281277770002"], ["Abdan", "6281277770003"]] as const) {
      const [row] = await db.insert(schema.employees).values({ workspaceId: ws.a.id, name, phone }).returning();
      people[name] = row.id;
    }
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  const body = () => ({
    platform: "Upwork",
    name: "Solid Digital - Figma webapp",
    startDate: "2025-12-23",
    endDate: "2025-12-29",
    status: "completed",
    paymentType: "hourly",
    feeReceived: 75,
    paymentStatus: "accepted",
    members: [
      { employeeId: people.Nanda, role: "pm_sales", sharePercent: 50 },
      { employeeId: people.Zainal, role: "designer", sharePercent: 10 },
      { employeeId: people.Abdan, role: "designer", sharePercent: 40 },
    ],
  });

  test("PM creates, lists and edits projects with computed fees", async () => {
    const res = await req(ws.a.pm, "/projects", { method: "POST", body: JSON.stringify(body()) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ platformFee: 7.5, splitBase: 67.5, currency: "USD", totalFee: null });
    expect(Object.fromEntries(created.members.map((m: any) => [m.employeeName, m.fee]))).toEqual({ Abdan: 27, Nanda: 33.75, Zainal: 6.75 });

    const { people: list } = await (await req(ws.a.pm, "/projects/people")).json();
    expect(list.map((p: any) => p.name)).toEqual(["Abdan", "Nanda", "Zainal"]);

    const edited = await req(ws.a.pm, `/projects/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...body(), totalFee: 50, members: [{ employeeId: people.Zainal, role: "developer", sharePercent: 100 }] }),
    });
    expect(await edited.json()).toMatchObject({ splitBase: 50, members: [{ employeeName: "Zainal", role: "developer", fee: 50 }] });
  });

  test("projects without a start date come last", async () => {
    const made = [];
    for (const startDate of [null, "2025-01-01", "2025-06-01"]) {
      const res = await req(ws.b.pm, "/projects", { method: "POST", body: JSON.stringify({ ...body(), name: `Order ${startDate}`, startDate, endDate: null, members: [] }) });
      made.push((await res.json()).id);
    }
    const { projects: list } = await (await req(ws.b.pm, "/projects")).json();
    expect(list.map((p: any) => p.startDate)).toEqual(["2025-06-01", "2025-01-01", null]);
    for (const id of made) await req(ws.b.pm, `/projects/${id}`, { method: "DELETE" });
  });

  test("members cannot be given the web-only PM role", async () => {
    const [pmRole] = (await (await req(ws.a.owner, "/roles")).json()).roles.filter((r: any) => r.name === "PM");
    const res = await req(ws.a.owner, `/employees/${people.Nanda}`, { method: "PATCH", body: JSON.stringify({ roleId: pmRole.id }) });
    expect(res.status).toBe(400);
  });

  test("PM is limited to projects; Manager cannot see fees", async () => {
    expect((await req(ws.a.pm, "/employees")).status).toBe(403);
    expect((await req(ws.a.pm, "/standups")).status).toBe(403);
    expect((await req(ws.a.pm, "/users")).status).toBe(403);
    expect((await req(ws.a.manager, "/projects")).status).toBe(403);
    expect((await req(ws.a.owner, "/projects")).status).toBe(200);
  });

  test("isolation: other workspaces' projects and people are off limits", async () => {
    const [project] = (await (await req(ws.a.owner, "/projects")).json()).projects;
    expect((await (await req(ws.b.pm, "/projects")).json()).projects).toEqual([]);
    expect((await req(ws.b.pm, `/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ ...body(), members: [] }) })).status).toBe(404);
    expect((await req(ws.b.pm, `/projects/${project.id}`, { method: "DELETE" })).status).toBe(404);
    // B cannot attach A's employees to its own project.
    expect((await req(ws.b.pm, "/projects", { method: "POST", body: JSON.stringify(body()) })).status).toBe(400);

    expect((await req(ws.a.pm, `/projects/${project.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await req(ws.a.pm, "/projects")).json()).projects).toEqual([]);
  });

  test("PM can be invited", async () => {
    const res = await req(ws.a.owner, "/users/invites", { method: "POST", body: JSON.stringify({ email: `pm-${suffix}@project.test`, role: "PM" }) });
    expect(res.status).toBe(201);
    expect((await res.json()).invite.role).toBe("PM");
  });
});
