/**
 * GitHub integration (M8): signature checks, normalization and attribution,
 * delivery/event dedup, tracked repositories and workspace isolation.
 * Needs a migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgres://.../ta_test bun test src/github.test.ts
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeEvent } from "./modules/github/events.js";
import { verifyWebhookSignature } from "./modules/github/app.js";

const SECRET = "test-webhook-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("github normalization", () => {
  const repository = { id: 42, full_name: "acme/api" };

  test("commits are credited to the GitHub-verified author only, never the pusher", () => {
    const events = normalizeEvent("push", {
      repository,
      ref: "refs/heads/main",
      pusher: { name: "lead" },
      commits: [
        { id: "a1", message: "fix: login\n\nbody", timestamp: "2026-11-10T03:00:00Z", author: { username: "budi", email: "b@x" }, committer: { username: "lead" } },
        { id: "a2", message: "chore", timestamp: "2026-11-10T03:01:00Z", author: { name: "Budi", email: "budi@laptop.local" } },
        { id: "a3", message: "deps", timestamp: "2026-11-10T03:02:00Z", author: { username: "dependabot[bot]" } },
      ],
    });
    expect(events.map((e) => [e.externalId, e.actorLogin, e.title])).toEqual([
      ["commit:42:a1", "budi", "fix: login"],
      ["commit:42:a2", null, "chore"],
      ["commit:42:a3", null, "deps"],
    ]);
    expect(normalizeEvent("push", { repository, deleted: true, commits: [] })).toEqual([]);
  });

  test("pull requests, reviews, issues and comments", () => {
    const pr = { number: 7, title: "Add check-in", html_url: "u", user: { login: "sari" }, merged: true, merged_by: { login: "lead" }, merged_at: "2026-11-10T05:00:00Z" };
    const [merged] = normalizeEvent("pull_request", { repository, action: "closed", pull_request: pr, sender: { login: "someone" } });
    expect(merged).toMatchObject({ type: "pr_merged", actorLogin: "lead", externalId: "pr:42:7:merged" });

    const [opened] = normalizeEvent("pull_request", { repository, action: "opened", pull_request: { ...pr, merged: false }, sender: { login: "sari" } });
    expect(opened).toMatchObject({ type: "pr_opened", actorLogin: "sari", title: "PR #7: Add check-in" });
    expect(normalizeEvent("pull_request", { repository, action: "labeled", pull_request: pr })).toEqual([]);

    const [review] = normalizeEvent("pull_request_review", {
      repository,
      action: "submitted",
      pull_request: pr,
      review: { id: 99, state: "APPROVED", user: { login: "budi" }, submitted_at: "2026-11-10T04:00:00Z" },
    });
    expect(review).toMatchObject({ type: "pr_reviewed", actorLogin: "budi", metadata: { number: 7, state: "approved" } });

    const [comment] = normalizeEvent("issue_comment", {
      repository,
      action: "created",
      issue: { number: 7, title: "Add check-in", pull_request: {} },
      comment: { id: 5, user: { login: "bot", type: "Bot" }, created_at: "2026-11-10T04:00:00Z" },
    });
    expect(comment).toMatchObject({ type: "pr_commented", actorLogin: null });

    const [issue] = normalizeEvent("issues", { repository, action: "opened", issue: { number: 3, title: "Bug", user: { login: "sari" }, created_at: "2026-11-10T01:00:00Z" } });
    expect(issue).toMatchObject({ type: "issue_opened", externalId: "issue:42:3:opened", actorLogin: "sari" });
  });

  test("signature verification", () => {
    expect(verifyWebhookSignature("{}", sign("{}"), SECRET)).toBe(true);
    expect(verifyWebhookSignature("{ }", sign("{}"), SECRET)).toBe(false);
    expect(verifyWebhookSignature("{}", undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature("{}", sign("{}"), "")).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("github webhooks", () => {
  let app: typeof import("./index.js").app;
  let db: any;
  let schema: typeof import("@repo/database");
  const ws: Record<"a" | "b", { id: string; token: string }> = {} as any;
  const employeeIds: Record<string, string> = {};
  const repoIds = { tracked: String(9_000_000 + Math.floor(Math.random() * 1_000_000)), untracked: "" };
  const installationId = String(70_000_000 + Math.floor(Math.random() * 1_000_000));
  let delivery = 0;

  const req = (who: "a" | "b", path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${ws[who].token}`, ...init.headers },
    });
  const hook = (event: string, payload: Record<string, unknown>, opts: { id?: string; signature?: string } = {}) => {
    const body = JSON.stringify({ installation: { id: Number(installationId) }, ...payload });
    return app.request("/github/webhook", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": opts.id ?? `test-${installationId}-${++delivery}`,
        "x-hub-signature-256": opts.signature ?? sign(body),
      },
    });
  };
  const push = (repoId: string, commits: Record<string, unknown>[]) =>
    hook("push", { ref: "refs/heads/main", repository: { id: Number(repoId), full_name: "acme/api" }, pusher: { name: "lead" }, commits });

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    repoIds.untracked = String(Number(repoIds.tracked) + 1);
    schema = await import("@repo/database");
    db = schema.createDbClient(url!);
    app = (await import("./index.js")).app;
    const { sign: signJwt } = await import("hono/jwt");
    const { eq } = await import("drizzle-orm");

    for (const name of ["Owner", "Admin", "Manager", "Employee"]) {
      await db.insert(schema.roles).values({ name }).onConflictDoNothing();
    }
    const [owner] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Owner"));
    for (const who of ["a", "b"] as const) {
      const workspace = await schema.createWorkspace(db, { name: `GitHub test ${who}` });
      const [user] = await db
        .insert(schema.users)
        .values({ workspaceId: workspace.id, email: `github-${who}-${workspace.id}@test.local`, name: who, roleId: owner.id })
        .returning();
      ws[who] = { id: workspace.id, token: await signJwt({ sub: user.id, role: "Owner", workspaceId: workspace.id }, process.env.JWT_SECRET ?? "dev-secret-change-me") };
    }
    for (const [name, phone] of [["Budi", "6281288880001"], ["Sari", "6281288880002"]] as const) {
      const res = await req("a", "/employees", { method: "POST", body: JSON.stringify({ name, phone }) });
      employeeIds[name] = (await res.json()).id;
    }

    // Linked as the setup callback would (it needs GitHub's API, so not exercised here).
    const [installation] = await db
      .insert(schema.githubInstallations)
      .values({ workspaceId: ws.a.id, installationId, accountLogin: "acme", accountType: "Organization" })
      .returning();
    for (const [id, isActive] of [[repoIds.tracked, true], [repoIds.untracked, false]] as const) {
      await db.insert(schema.trackedRepositories).values({
        workspaceId: ws.a.id,
        installationId: installation.id,
        githubRepoId: id,
        owner: "acme",
        name: `repo-${id}`,
        fullName: `acme/repo-${id}`,
        isActive,
      });
    }
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    if (db && ws.a && ws.b) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws.a.id, ws.b.id]));
  });

  test("rejects bad signatures", async () => {
    const res = await hook("push", { repository: { id: 1 } }, { signature: sign("other body") });
    expect(res.status).toBe(401);
  });

  test("identity mapping validates and refuses duplicates", async () => {
    expect((await req("a", `/github/members/${employeeIds.Budi}`, { method: "PUT", body: JSON.stringify({ login: "bad login!" }) })).status).toBe(400);
    expect((await req("a", `/github/members/${employeeIds.Budi}`, { method: "PUT", body: JSON.stringify({ login: "@Budi-Dev" }) })).status).toBe(200);
    expect((await req("a", `/github/members/${employeeIds.Sari}`, { method: "PUT", body: JSON.stringify({ login: "budi-dev" }) })).status).toBe(409);
    // Another workspace cannot map A's employee.
    expect((await req("b", `/github/members/${employeeIds.Sari}`, { method: "PUT", body: JSON.stringify({ login: "sari" }) })).status).toBe(404);
  });

  test("push: attribution, delivery dedup, event dedup, untracked repos", async () => {
    const commits = [
      { id: "c1", message: "feat: x", timestamp: "2026-11-10T03:00:00Z", author: { username: "budi-dev" } },
      { id: "c2", message: "wip", timestamp: "2026-11-10T03:01:00Z", author: { name: "Budi", email: "budi@laptop" } },
      { id: "c3", message: "by sari", timestamp: "2026-11-10T03:02:00Z", author: { username: "sari-gh" } },
    ];
    const first = await push(repoIds.tracked, commits);
    expect(await first.json()).toEqual({ status: "processed", stored: 3 });

    const again = await hook("push", { ref: "refs/heads/main", repository: { id: Number(repoIds.tracked) }, commits }, { id: "fixed-delivery" });
    expect((await again.json()).stored).toBe(0); // same commits, new delivery
    expect((await (await hook("push", {}, { id: "fixed-delivery" })).json()).status).toBe("duplicate");

    expect((await (await push(repoIds.untracked, commits)).json()).reason).toBe("repository not tracked");

    const { activity } = await (await req("a", "/github/activity")).json();
    const byTitle = Object.fromEntries(activity.map((a: any) => [a.title, a]));
    expect(byTitle["feat: x"].employeeName).toBe("Budi");
    expect(byTitle["wip"].employeeId).toBeNull(); // name/email alone is not evidence
    expect(byTitle["by sari"]).toMatchObject({ employeeId: null, actorLogin: "sari-gh" });
  });

  test("mapping later claims past activity; remapping releases it", async () => {
    await req("a", `/github/members/${employeeIds.Sari}`, { method: "PUT", body: JSON.stringify({ login: "sari-gh" }) });
    let { activity } = await (await req("a", `/github/activity?employeeId=${employeeIds.Sari}`)).json();
    expect(activity.map((a: any) => a.title)).toEqual(["by sari"]);

    await req("a", `/github/members/${employeeIds.Sari}`, { method: "PUT", body: JSON.stringify({ login: null }) });
    ({ activity } = await (await req("a", `/github/activity?employeeId=${employeeIds.Sari}`)).json());
    expect(activity).toEqual([]);
    const { members } = await (await req("a", "/github/members")).json();
    expect(members.find((m: any) => m.employeeId === employeeIds.Budi).login).toBe("Budi-Dev");
  });

  test("PR merge goes to the merger; summary counts; isolation", async () => {
    const pr = { number: 12, title: "Ship it", html_url: "u", user: { login: "sari-gh" }, merged: true, merged_by: { login: "budi-dev" }, merged_at: "2026-11-11T05:00:00Z" };
    const res = await hook("pull_request", { action: "closed", pull_request: pr, repository: { id: Number(repoIds.tracked) }, sender: { login: "budi-dev" } });
    expect((await res.json()).stored).toBe(1);

    const { summary } = await (await req("a", "/github/activity/summary?days=3650")).json();
    expect(summary).toEqual([{ employeeId: employeeIds.Budi, employeeName: "Budi", counts: { commit: 1, pr_merged: 1 } }]);

    expect((await (await req("b", "/github/activity")).json()).activity).toEqual([]);
    expect((await (await req("b", "/github/status")).json()).repositories).toEqual([]);
  });

  test("tracking toggle and uninstall", async () => {
    const { repositories } = await (await req("a", "/github/status")).json();
    const tracked = repositories.find((r: any) => r.githubRepoId === repoIds.tracked);
    expect((await req("b", `/github/repositories/${tracked.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })).status).toBe(404);
    expect((await req("a", `/github/repositories/${tracked.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })).status).toBe(200);
    expect((await (await push(repoIds.tracked, [{ id: "c9", message: "late" }])).json()).reason).toBe("repository not tracked");

    await hook("installation", { action: "deleted" });
    expect((await (await req("a", "/github/status")).json()).installations).toEqual([]);
    expect((await (await push(repoIds.tracked, [{ id: "c10", message: "after" }])).json()).reason).toBe("installation not linked");
  });

  test("setup callback rejects a forged state", async () => {
    const res = await app.request(`/github/setup?installation_id=${installationId}&setup_action=install&state=forged&code=x`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("github_error=");
  });
});
