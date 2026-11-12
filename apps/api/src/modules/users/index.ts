import { Hono } from "hono";
import { inviteUserSchema, updateWebUserSchema } from "@repo/shared";
import { audit, requireRole } from "../auth/index.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import {
  createInvite,
  getInviteInfo,
  listInvites,
  listWebUsers,
  revokeInvite,
  updateWebUser,
} from "./service.js";

// Web dashboard users and email invites (Settings -> Pengguna).
export const usersApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");

usersApi.get("/", canManage, async (c) => {
  const ws = getWorkspaceId(c);
  const [users, invites] = await Promise.all([listWebUsers(ws), listInvites(ws)]);
  return c.json({ users, invites });
});

usersApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateWebUserSchema, await c.req.json());
  const user = await updateWebUser(getWorkspaceId(c), c.req.param("id"), input, getActorId(c));
  await audit(getWorkspaceId(c), getActorId(c), "user.update", "users", user.id, input);
  return c.json(user);
});

usersApi.post("/invites", canManage, async (c) => {
  const input = parseWith(inviteUserSchema, await c.req.json());
  const { invite, token } = await createInvite(getWorkspaceId(c), input, getActorId(c));
  await audit(getWorkspaceId(c), getActorId(c), "user.invite", "workspace_invites", invite.id, input);
  return c.json({ invite, url: `${WEB_URL}/?invite=${token}` }, 201);
});

usersApi.delete("/invites/:id", canManage, async (c) => {
  const row = await revokeInvite(getWorkspaceId(c), c.req.param("id"));
  await audit(getWorkspaceId(c), getActorId(c), "user.invite.revoke", "workspace_invites", row.id, { email: row.email });
  return c.json({ revoked: true });
});

// Public: what the invite link's landing page shows before Google sign-in.
usersApi.get("/invites/info/:token", async (c) => {
  const info = await getInviteInfo(c.req.param("token"));
  if (!info) return c.json({ error: "Undangan tidak berlaku atau sudah dipakai" }, 404);
  return c.json(info);
});
