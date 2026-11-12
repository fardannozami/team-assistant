import { createHash, randomBytes } from "node:crypto";
import { createDbClient, roles, users, workspaceInvites, workspaces } from "@repo/database";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { InviteUserInput, UpdateWebUserInput } from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";

// No imports from ../auth: the auth module calls acceptPendingInvite.
const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function roleId(name: string) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new HttpError(400, `Role ${name} not found`);
  return role.id;
}

function pending() {
  return and(isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, new Date()));
}

async function userByEmail(email: string) {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return user ?? null;
}

// ---- Invites ----

/**
 * Creates an invite and returns its one-time link token (only its hash is
 * stored). Re-inviting an email replaces its pending invite.
 */
export async function createInvite(
  workspaceId: string,
  input: InviteUserInput,
  actorId: string | null,
) {
  const existing = await userByEmail(input.email);
  if (existing) {
    throw new HttpError(
      409,
      existing.workspaceId === workspaceId
        ? "Email ini sudah menjadi pengguna workspace ini."
        : "Email ini sudah terdaftar di workspace lain. Satu akun Google hanya bisa memakai satu workspace.",
    );
  }

  const token = randomBytes(24).toString("base64url");
  const role = await roleId(input.role);
  const invite = await db.transaction(async (tx) => {
    await tx
      .update(workspaceInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.email, input.email), pending()));
    const [created] = await tx
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: input.email,
        roleId: role,
        tokenHash: hashToken(token),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    return created!;
  });
  return { invite: { id: invite.id, email: invite.email, role: input.role, expiresAt: invite.expiresAt }, token };
}

export async function listInvites(workspaceId: string) {
  return db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: roles.name,
      invitedBy: users.name,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
    })
    .from(workspaceInvites)
    .innerJoin(roles, eq(workspaceInvites.roleId, roles.id))
    .leftJoin(users, eq(workspaceInvites.invitedBy, users.id))
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), pending()))
    .orderBy(desc(workspaceInvites.createdAt));
}

export async function revokeInvite(workspaceId: string, id: string) {
  const [row] = await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceInvites.id, id), eq(workspaceInvites.workspaceId, workspaceId), pending()))
    .returning();
  if (!row) throw new HttpError(404, "Undangan tidak ditemukan atau sudah tidak berlaku");
  return row;
}

/** Public landing-page info for an invite link; null when invalid or used. */
export async function getInviteInfo(token: string) {
  const [row] = await db
    .select({ email: workspaceInvites.email, role: roles.name, workspaceName: workspaces.name, expiresAt: workspaceInvites.expiresAt })
    .from(workspaceInvites)
    .innerJoin(roles, eq(workspaceInvites.roleId, roles.id))
    .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .where(and(eq(workspaceInvites.tokenHash, hashToken(token)), pending(), eq(workspaces.isActive, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Called on Google sign-in for an email with no account: joins the workspace
 * of its newest pending invite. Returns the new user, or null without one.
 */
export async function acceptPendingInvite(email: string, name: string) {
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .where(and(eq(workspaceInvites.email, email.toLowerCase()), pending(), eq(workspaces.isActive, true)))
    .orderBy(desc(workspaceInvites.createdAt))
    .limit(1);
  if (!invite) return null;
  const row = invite.workspace_invites;

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(workspaceInvites.id, row.id), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt)))
      .returning({ id: workspaceInvites.id });
    if (!claimed) return null;
    const [user] = await tx
      .insert(users)
      .values({ workspaceId: row.workspaceId, email: email.toLowerCase(), name, roleId: row.roleId })
      .returning();
    return user ?? null;
  });
}

// ---- Web users ----

export async function listWebUsers(workspaceId: string) {
  const [workspace] = await db.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: roles.name, isActive: users.isActive, createdAt: users.createdAt })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(users.createdAt);
  return rows.map((r) => ({ ...r, isOwner: r.id === workspace?.ownerUserId || r.role === "Owner" }));
}

/** Role/active changes for invited users; the Owner and oneself are off limits. */
export async function updateWebUser(
  workspaceId: string,
  id: string,
  input: UpdateWebUserInput,
  actorId: string | null,
) {
  if (id === actorId) throw new HttpError(400, "Anda tidak bisa mengubah akun Anda sendiri.");
  const target = (await listWebUsers(workspaceId)).find((u) => u.id === id);
  if (!target) throw new HttpError(404, "Pengguna tidak ditemukan");
  if (target.isOwner) throw new HttpError(403, "Owner workspace tidak bisa diubah.");

  const changes: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.role) changes.roleId = await roleId(input.role);
  if (input.isActive !== undefined) changes.isActive = input.isActive;
  await db.update(users).set(changes).where(and(eq(users.id, id), eq(users.workspaceId, workspaceId)));
  return (await listWebUsers(workspaceId)).find((u) => u.id === id)!;
}
