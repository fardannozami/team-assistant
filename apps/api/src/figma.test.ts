/**
 * Figma integration (M9): link parsing, normalization of versions, comments
 * and webhooks, passcode checks, dedup, polling and identity mapping.
 * The database part needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/figma.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { commentActivity, parseFileKey, versionActivity, webhookActivity } from "./modules/figma/events.js";

const KEY = "AbCdEf1234567890XyZ";

describe("figma normalization", () => {
  test("file keys come from any figma.com file link, or a bare key", () => {
    expect(parseFileKey(`https://www.figma.com/design/${KEY}/Landing-Page?node-id=1-2`)).toBe(KEY);
    expect(parseFileKey(`https://figma.com/file/${KEY}/Old`)).toBe(KEY);
    expect(parseFileKey(`https://www.figma.com/board/${KEY}/Brainstorm`)).toBe(KEY);
    expect(parseFileKey(`  ${KEY} `)).toBe(KEY);
    expect(parseFileKey(`https://evil.example/design/${KEY}`)).toBeNull();
    expect(parseFileKey("https://www.figma.com/files/recents")).toBeNull();
    expect(parseFileKey("not a link")).toBeNull();
  });

  test("named versions vs autosaves, both credited to the Figma user id", () => {
    const user = { id: "111", handle: "Sari" };
    expect(versionActivity(KEY, { id: "v1", created_at: "2026-11-10T03:00:00Z", label: "Hi-fi v2", description: null, user })).toMatchObject({
      type: "version_saved",
      externalId: `version:${KEY}:v1`,
      actorId: "111",
      title: "Hi-fi v2",
    });
    expect(versionActivity(KEY, { id: "v2", created_at: "2026-11-10T04:00:00Z", label: null, description: "", user })).toMatchObject({
      type: "file_edited",
      actorId: "111",
    });
    expect(versionActivity(KEY, { id: "v3", created_at: "garbage", label: null, description: null, user })).toBeNull();
  });

  test("comments and replies", () => {
    const base = { created_at: "2026-11-10T03:00:00Z", user: { id: "222", handle: "Budi" } };
    expect(commentActivity(KEY, { id: "c1", message: "Spacing  is\noff", ...base })).toMatchObject({ type: "commented", title: "Spacing is off" });
    expect(commentActivity(KEY, { id: "c2", parent_id: "c1", message: "Fixed", ...base })).toMatchObject({ type: "comment_replied", actorId: "222" });
  });

  test("webhooks match polling ids; FILE_UPDATE has no actor", () => {
    const version = webhookActivity({ event_type: "FILE_VERSION_UPDATE", file_key: KEY, version_id: "v1", label: "Hi-fi v2", created_at: "2026-11-10T03:00:00Z", triggered_by: { id: "111", handle: "Sari" } });
    expect(version?.externalId).toBe(`version:${KEY}:v1`);
    const comment = webhookActivity({ event_type: "FILE_COMMENT", file_key: KEY, comment_id: "c1", comment: [{ text: "Hi " }, { mention: "Budi" }], timestamp: "2026-11-10T03:00:00Z", triggered_by: { id: "222", handle: "Sari" } });
    expect(comment).toMatchObject({ externalId: `comment:${KEY}:c1`, title: "Hi @Budi", actorId: "222" });
    const update = webhookActivity({ event_type: "FILE_UPDATE", file_key: KEY, file_name: "Landing", timestamp: "2026-11-10T03:00:00Z" });
    expect(update).toMatchObject({ type: "file_updated", actorId: null });
    expect(webhookActivity({ event_type: "PING", file_key: KEY })).toBeNull();
    expect(webhookActivity({ event_type: "LIBRARY_PUBLISH", file_key: KEY })).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("figma webhooks, sync and mapping", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  const ws: Record<"a" | "b", { id: string; token: string; passcode: string }> = {} as any;
  const employeeIds: Record<string, string> = {};
  const fileKey = `Fg${Math.random().toString(36).slice(2, 14)}x`;
  const realFetch = globalThis.fetch;

  const req = (who: "a" | "b", path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${ws[who].token}`, ...init.headers },
    });
  const hook = (payload: Record<string, unknown>) =>
    app.request("/figma/webhook", { method: "POST", body: JSON.stringify({ file_key: fileKey, ...payload }), headers: { "content-type": "application/json" } });
  const activity = async (who: "a" | "b") => ((await (await req(who, "/figma/activity")).json()) as { activity: any[] }).activity;

  beforeAll(async () => {
    delete process.env.PUBLIC_API_URL; // no webhook registration against the real Figma
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    const { sign: signJwt } = await import("hono/jwt");
    const { eq } = await import("drizzle-orm");
    const { encryptSecret } = await import("./lib/secrets.js");

    for (const name of ["Owner", "Admin", "Manager", "Employee"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const [owner] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Owner"));
    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `Figma test ${who}` });
      const [user] = await db
        .insert(schema.users)
        .values({ workspaceId: workspace.id, email: `figma-${who}-${workspace.id}@test.local`, name: who, roleId: owner.id })
        .returning();
      const passcode = `pass-${who}-${workspace.id}`;
      ws[who] = {
        id: workspace.id,
        passcode,
        token: await signJwt({ sub: user.id, role: "Owner", workspaceId: workspace.id }, process.env.JWT_SECRET ?? "dev-secret-change-me"),
      };
      // Both workspaces track the same file; the passcode tells them apart.
      await db.insert(schema.figmaConnections).values({
        workspaceId: workspace.id,
        accessToken: await encryptSecret(`figd_token_${who}`),
        tokenHint: "0000",
        accountId: who === "a" ? "900" : "901",
        accountHandle: `Owner ${who}`,
        webhookPasscode: await encryptSecret(passcode),
      });
      await db.insert(schema.trackedFigmaFiles).values({ workspaceId: workspace.id, fileKey, name: "Landing" });
    }
    const res = await req("a", "/employees", { method: "POST", body: JSON.stringify({ name: "Sari", phone: "6281288870001" }) });
    employeeIds.Sari = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  test("webhooks need the workspace's passcode", async () => {
    expect((await hook({ event_type: "FILE_UPDATE", timestamp: "2026-11-10T03:00:00Z" })).status).toBe(401);
    expect((await hook({ event_type: "FILE_UPDATE", passcode: "wrong", timestamp: "2026-11-10T03:00:00Z" })).status).toBe(401);
    expect((await hook({ event_type: "PING", passcode: ws.a.passcode })).status).toBe(200);
  });

  test("events land in the workspace whose passcode matched, once", async () => {
    const version = { event_type: "FILE_VERSION_UPDATE", passcode: ws.a.passcode, version_id: "v1", label: "Hi-fi", created_at: "2026-11-10T03:00:00Z", triggered_by: { id: "111", handle: "Sari" } };
    expect(await (await hook(version)).json()).toEqual({ status: "processed", stored: 1 });
    expect(await (await hook(version)).json()).toEqual({ status: "processed", stored: 0 });
    await hook({ event_type: "FILE_UPDATE", passcode: ws.a.passcode, timestamp: "2026-11-10T05:00:00Z" });

    const a = await activity("a");
    expect(a.map((x) => [x.type, x.actorId, x.employeeId])).toEqual([
      ["file_updated", null, null],
      ["version_saved", "111", null],
    ]);
    expect(await activity("b")).toEqual([]);
  });

  test("mapping a Figma account attributes its past events; FILE_UPDATE stays unattributed", async () => {
    expect((await req("b", "/figma/accounts/111", { method: "PUT", body: JSON.stringify({ employeeId: employeeIds.Sari }) })).status).toBe(404);
    expect((await req("a", "/figma/accounts/111", { method: "PUT", body: JSON.stringify({ employeeId: employeeIds.Sari }) })).status).toBe(200);

    const a = await activity("a");
    expect(a.find((x) => x.type === "version_saved")?.employeeName).toBe("Sari");
    expect(a.find((x) => x.type === "file_updated")?.employeeId).toBeNull();

    const accounts = ((await (await req("a", "/figma/accounts")).json()) as { accounts: any[] }).accounts;
    expect(accounts.find((x) => x.figmaId === "111")).toMatchObject({ handle: "Sari", employeeName: "Sari", events: 1 });
    expect(accounts.find((x) => x.figmaId === "900")).toMatchObject({ handle: "Owner a", employeeId: null });

    // New events from a mapped account are attributed on arrival.
    await hook({ event_type: "FILE_COMMENT", passcode: ws.a.passcode, comment_id: "c9", comment: [{ text: "ok" }], timestamp: "2026-11-10T06:00:00Z", triggered_by: { id: "111", handle: "Sari" } });
    expect((await activity("a"))[0]).toMatchObject({ type: "commented", employeeName: "Sari" });
  });

  test("polling stores recent versions and comments without duplicating webhook ones", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (path.endsWith("/versions")) {
        return json({ versions: [
          { id: "v1", created_at: "2026-11-10T03:00:00Z", label: "Hi-fi", description: null, user: { id: "111", handle: "Sari" } },
          { id: "v7", created_at: recent, label: null, description: null, user: { id: "111", handle: "Sari" } },
          { id: "v0", created_at: old, label: "ancient", description: null, user: { id: "111", handle: "Sari" } },
        ] });
      }
      if (path.endsWith("/comments")) return json({ comments: [{ id: "c10", message: "Looks good", created_at: recent, user: { id: "333", handle: "Raka" } }] });
      if (path.startsWith("/v1/files/")) return json({ name: "Landing v2", lastModified: recent, editorType: "figma" });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const result = (await (await req("a", "/figma/sync", { method: "POST" })).json()) as { stored: number; errors: string[] };
    globalThis.fetch = realFetch;
    expect(result).toMatchObject({ stored: 2, errors: [] });

    const a = await activity("a");
    expect(a.filter((x) => x.type === "version_saved")).toHaveLength(1); // v1 came by webhook already; v0 is too old
    expect(a.find((x) => x.type === "file_edited")).toMatchObject({ employeeName: "Sari", file: "Landing v2" });
    expect(a.find((x) => x.actorId === "333")).toMatchObject({ type: "commented", employeeId: null });

    const status = (await (await req("a", "/figma/status")).json()) as { files: { name: string }[]; lastSyncedAt: string | null };
    expect(status.files[0]!.name).toBe("Landing v2");
    expect(status.lastSyncedAt).not.toBeNull();
  });

  test("an untracked file's events are ignored", async () => {
    const [file] = (await (await req("a", "/figma/status")).json() as { files: { id: string }[] }).files;
    expect((await req("a", `/figma/files/${file!.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })).status).toBe(200);
    expect(await (await hook({ event_type: "FILE_UPDATE", passcode: ws.a.passcode, timestamp: "2026-11-11T03:00:00Z" })).json()).toMatchObject({ status: "ignored" });
  });
});
