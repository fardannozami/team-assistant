/**
 * Weekly check-out and Monday ice breaker: config API, prompts, the WhatsApp
 * answer flow and the dashboard results. Needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/checkins.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("check-ins", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  let checkins: typeof import("./modules/checkins/service.js");
  let engine: typeof import("./modules/checkins/engine.js");
  const ws: Record<"a" | "b", { id: string; token: string }> = {} as any;
  let employee: { id: string; workspaceId: string; isActive: boolean };
  const sent: { jid: string; text: string }[] = [];
  const send = async (jid: string, text: string) => {
    sent.push({ jid, text });
  };

  const req = (who: "a" | "b", path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${ws[who].token}`, ...init.headers },
    });
  const reply = (body: string) => engine.handleCheckinMessage({ employee, body });

  beforeAll(async () => {
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    checkins = await import("./modules/checkins/service.js");
    engine = await import("./modules/checkins/engine.js");
    const { sign } = await import("hono/jwt");
    const { eq } = await import("drizzle-orm");

    for (const name of ["Owner", "Admin", "Manager", "Employee"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const [owner] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Owner"));
    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `Checkin test ${who}` });
      const [user] = await db
        .insert(schema.users)
        .values({ workspaceId: workspace.id, email: `checkin-${who}-${workspace.id}@test.local`, name: who, roleId: owner.id })
        .returning();
      const token = await sign({ sub: user.id, role: "Owner", workspaceId: workspace.id }, process.env.JWT_SECRET ?? "dev-secret-change-me");
      ws[who] = { id: workspace.id, token };
    }
    const created = await req("a", "/employees", { method: "POST", body: JSON.stringify({ name: "Sari", phone: "6281277770001" }) });
    const body = await created.json();
    employee = { id: body.id, workspaceId: ws.a.id, isActive: true };
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  test("config defaults, validation and save", async () => {
    const { configs } = await (await req("a", "/checkins/config")).json();
    const checkout = configs.find((c: any) => c.kind === "checkout");
    expect(checkout).toMatchObject({ id: null, isActive: false, weekdays: [5], timeOfDay: "16:00" });

    const dupKeys = await req("a", "/checkins/config/checkout", {
      method: "PUT",
      body: JSON.stringify({ ...checkout, isActive: true, questions: [checkout.questions[0], checkout.questions[0]] }),
    });
    expect(dupKeys.status).toBe(400);
    expect((await req("a", "/checkins/config/nope", { method: "PUT", body: JSON.stringify(checkout) })).status).toBe(404);

    for (const kind of ["checkout", "icebreaker"]) {
      const defaults = configs.find((c: any) => c.kind === kind);
      const { id: _id, kind: _kind, ...input } = defaults;
      const saved = await req("a", `/checkins/config/${kind}`, { method: "PUT", body: JSON.stringify({ ...input, isActive: true }) });
      expect(saved.status).toBe(200);
      expect((await saved.json()).isActive).toBe(true);
    }
    // Workspace B still has only defaults.
    const other = (await (await req("b", "/checkins/config")).json()).configs;
    expect(other.every((c: any) => c.id === null)).toBe(true);
  });

  test("check-out: prompt, mood validation, sequential answers, summary", async () => {
    const result = await checkins.sendCheckinPrompts(ws.a.id, { kind: "checkout", send, force: true });
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(sent.at(-1)!.text).toContain("check-out mingguan");
    expect(sent.at(-1)!.text).toContain("(1/5)");

    expect(await reply("mantap")).toContain("angka 1–5");
    expect(await reply("4 capek tapi puas")).toContain("(2/5)");
    expect(await reply("Rilis fitur check-in")).toContain("(3/5)");
    expect(await reply("Migrasi belum selesai")).toContain("(4/5)");
    expect(await reply("Selesaikan migrasi")).toContain("(5/5)");
    const done = await reply("-");
    expect(done).toContain("Check-out mingguan tercatat");
    expect(done).toContain("4 🙂");
    // Finished: plain text is no longer ours, the keyword shows the summary.
    expect(await reply("halo")).toBeNull();
    expect(await reply("CHECKOUT")).toContain("Rilis fitur check-in");

    // A second run the same day skips people who already have a session.
    expect(await checkins.sendCheckinPrompts(ws.a.id, { kind: "checkout", send, force: true })).toMatchObject({ sent: 0, skipped: 1 });

    const responses = await checkins.listCheckinResponses(ws.a.id, "checkout");
    expect(responses.rows).toHaveLength(1);
    expect(responses.rows[0]).toMatchObject({ status: "completed", mood: 4 });
    expect(responses.rows[0]!.answers.notes).toBe("-");
    expect(responses.averageMood).toBe(4);

    expect((await (await req("b", "/checkins/checkout/responses")).json()).rows).toHaveLength(0);
  });

  test("ice breaker: motivation, standup takes over, keyword resumes", async () => {
    const { eq, and } = await import("drizzle-orm");
    const { dateInTimezone } = await import("@repo/shared");
    const { MOTIVATION_QUOTES } = await import("./modules/checkins/defaults.js");

    await checkins.sendCheckinPrompts(ws.a.id, { kind: "icebreaker", send, force: true });
    const prompt = sent.at(-1)!.text;
    expect(prompt).toContain("Selamat pagi Sari");
    expect(MOTIVATION_QUOTES.some((q) => prompt.includes(q))).toBe(true);

    // "mood ..." with more words is an answer, not the keyword.
    expect(await reply("mood tim lagi turun")).toContain("angka 1–5");
    expect(await reply("🤩")).toContain("(2/2)");

    // A standup prompted afterwards gets plain text; MOOD still reaches the ice breaker.
    await db.insert(schema.standupSessions).values({ workspaceId: ws.a.id, employeeId: employee.id, date: dateInTimezone(), status: "pending" });
    expect(await reply("kemarin ngoding")).toBeNull();
    expect(await reply("STANDUP")).toBeNull();
    expect(await reply("MOOD: naik gunung")).toContain("Ice breaking tercatat");

    const [session] = await db
      .select()
      .from(schema.checkinSessions)
      .where(and(eq(schema.checkinSessions.employeeId, employee.id), eq(schema.checkinSessions.kind, "icebreaker")));
    expect(session.status).toBe("completed");
    expect((await checkins.listCheckinResponses(ws.a.id, "icebreaker")).rows[0]!.mood).toBe(5);
  });

  test("a new period closes the previous open session; reminders and close", async () => {
    const { eq } = await import("drizzle-orm");
    const [config] = await db.select().from(schema.checkinConfigs).where(eq(schema.checkinConfigs.workspaceId, ws.a.id));
    await db.delete(schema.checkinSessions).where(eq(schema.checkinSessions.workspaceId, ws.a.id));
    await db.insert(schema.checkinSessions).values({
      workspaceId: ws.a.id,
      configId: config.id,
      employeeId: employee.id,
      kind: config.kind,
      date: "2000-01-07",
      questions: config.questions,
    });

    await checkins.sendCheckinPrompts(ws.a.id, { configId: config.id, send, force: true });
    const rows = await db.select().from(schema.checkinSessions).where(eq(schema.checkinSessions.employeeId, employee.id));
    expect(rows.find((r: any) => r.date === "2000-01-07").status).toBe("missed");

    expect(await checkins.sendCheckinReminders(ws.a.id, { configId: config.id, send })).toMatchObject({ sent: 1 });
    expect(sent.at(-1)!.text).toContain("Pengingat");
    expect(await checkins.closeCheckins(ws.a.id, { configId: config.id })).toMatchObject({ missed: 1 });
    expect(await reply("jawaban telat")).toBeNull();
  });

  test("worker-only endpoints reject other roles' tokens without workspace access", async () => {
    const res = await app.request("/checkins/trigger", { method: "POST", body: JSON.stringify({ kind: "checkout" }) });
    expect(res.status).toBe(401);
  });
});
