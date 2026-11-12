/**
 * Web dashboard invites: create/list/revoke, joining on Google sign-in,
 * role changes and the Owner/self guards. Needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/users.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("web users & invites", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  let users: typeof import("./modules/users/service.js");
  let signJwt: typeof import("hono/jwt").sign;
  const ws: Record<"a" | "b", { id: string; token: string; ownerId: string }> = {} as any;
  const suffix = Date.now().toString(36);
  const email = (name: string) => `${name}-${suffix}@invite.test`;

  const req = (token: string, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
    });
  const tokenFor = (user: { id: string; workspaceId: string }, role: string) =>
    signJwt({ sub: user.id, role, workspaceId: user.workspaceId }, process.env.JWT_SECRET ?? "dev-secret-change-me");

  beforeAll(async () => {
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    users = await import("./modules/users/service.js");
    signJwt = (await import("hono/jwt")).sign;
    const { eq } = await import("drizzle-orm");

    for (const name of ["Owner", "Admin", "Manager", "Employee"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const [owner] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Owner"));
    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `Invite test ${who}` });
      const [user] = await db
        .insert(schema.users)
        .values({ workspaceId: workspace.id, email: email(`owner-${who}`), name: `Owner ${who}`, roleId: owner.id })
        .returning();
      await db.update(schema.workspaces).set({ ownerUserId: user.id }).where(eq(schema.workspaces.id, workspace.id));
      ws[who] = { id: workspace.id, token: await tokenFor(user, "Owner"), ownerId: user.id };
    }
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  test("invite, landing info, join on sign-in, link is single-use", async () => {
    expect((await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: "nope", role: "Admin" }) })).status).toBe(400);
    expect((await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: email("x"), role: "Owner" }) })).status).toBe(400);

    const res = await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: ` ${email("Rina").toUpperCase()} `, role: "Admin" }) });
    expect(res.status).toBe(201);
    const { invite, url: link } = await res.json();
    expect(invite).toMatchObject({ email: email("rina"), role: "Admin" });
    const token = new URL(link).searchParams.get("invite")!;

    const info = await app.request(`/users/invites/info/${token}`);
    expect(await info.json()).toMatchObject({ email: email("rina"), role: "Admin", workspaceName: "Invite test a" });
    expect((await app.request("/users/invites/info/wrong-token")).status).toBe(404);

    // Other workspaces cannot see it; signing in with the email joins workspace A.
    expect((await (await req(ws.b.token, "/users")).json()).invites).toEqual([]);
    const joined = await users.acceptPendingInvite(email("rina"), "Rina");
    expect(joined).toMatchObject({ workspaceId: ws.a.id, email: email("rina") });
    expect(await users.acceptPendingInvite(email("rina"), "Rina")).toBeNull();
    expect((await app.request(`/users/invites/info/${token}`)).status).toBe(404);

    const list = await (await req(ws.a.token, "/users")).json();
    expect(list.invites).toEqual([]);
    expect(list.users.map((u: any) => [u.email, u.role, u.isOwner])).toEqual([
      [email("owner-a"), "Owner", true],
      [email("rina"), "Admin", false],
    ]);

    // Joined users cannot be invited again, here or elsewhere.
    expect((await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: email("rina"), role: "Manager" }) })).status).toBe(409);
    expect((await req(ws.b.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: email("rina"), role: "Manager" }) })).status).toBe(409);
  });

  test("re-invite replaces, revoke and expiry stop joining", async () => {
    const make = async (role: string) =>
      (await (await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: email("dodi"), role }) })).json()).invite;
    await make("Admin");
    const second = await make("Manager");
    const { invites } = await (await req(ws.a.token, "/users")).json();
    expect(invites.map((i: any) => [i.email, i.role])).toEqual([[email("dodi"), "Manager"]]);

    expect((await req(ws.b.token, `/users/invites/${second.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await req(ws.a.token, `/users/invites/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await users.acceptPendingInvite(email("dodi"), "Dodi")).toBeNull();

    const { eq } = await import("drizzle-orm");
    const third = await make("Manager");
    await db.update(schema.workspaceInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workspaceInvites.id, third.id));
    expect(await users.acceptPendingInvite(email("dodi"), "Dodi")).toBeNull();
  });

  test("role changes, Owner/self guards, deactivation revokes access, managers cannot manage", async () => {
    await req(ws.a.token, "/users/invites", { method: "POST", body: JSON.stringify({ email: email("maya"), role: "Manager" }) });
    const maya = (await users.acceptPendingInvite(email("maya"), "Maya"))!;
    const mayaToken = await tokenFor(maya, "Manager");

    expect((await req(mayaToken, "/users")).status).toBe(403);
    expect((await req(mayaToken, "/employees")).status).toBe(200);

    expect((await req(ws.a.token, `/users/${ws.a.ownerId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })).status).toBe(400);
    expect((await req(ws.b.token, `/users/${maya.id}`, { method: "PATCH", body: JSON.stringify({ role: "Admin" }) })).status).toBe(404);

    const promoted = await req(ws.a.token, `/users/${maya.id}`, { method: "PATCH", body: JSON.stringify({ role: "Admin" }) });
    expect(await promoted.json()).toMatchObject({ role: "Admin", isActive: true });
    // An admin still cannot touch the Owner.
    const adminToken = await tokenFor(maya, "Admin");
    expect((await req(adminToken, `/users/${ws.a.ownerId}`, { method: "PATCH", body: JSON.stringify({ role: "Manager" }) })).status).toBe(403);

    await req(ws.a.token, `/users/${maya.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
    expect((await req(adminToken, "/employees")).status).toBe(401);
  });
});
