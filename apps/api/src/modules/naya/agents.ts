import { createDbClient, nayaAgents } from "@repo/database";
import { HERMES_PROFILE, NAYA_POLICY, NAYA_VIEWS, nayaCan, nayaSees, type NayaAgentInput, type NayaView } from "@repo/shared";
import { and, asc, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { HttpError } from "../../lib/http-error.js";

// The Hermes profiles registered for Naya: display name, who may chat with them, and the
// profile's API_SERVER_KEY (encrypted) for the chat proxy.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type NayaAgent = {
  profile: string;
  displayName: string;
  description: string | null;
  chatRoles: string[];
  isLead: boolean;
  hasKey: boolean;
  apiKeyHint: string | null;
};

function profileName(value: string): string {
  if (!HERMES_PROFILE.test(value)) throw new HttpError(404, "Agent tidak dikenal.");
  return value;
}

export async function listNayaAgents(workspaceId: string): Promise<NayaAgent[]> {
  const rows = await db
    .select()
    .from(nayaAgents)
    .where(eq(nayaAgents.workspaceId, workspaceId))
    .orderBy(asc(nayaAgents.displayName));
  // The lead first: it answers "Tanya Naya".
  return rows
    .sort((a, b) => Number(b.isLead) - Number(a.isLead))
    .map((row) => ({
      profile: row.profile,
      displayName: row.displayName,
      description: row.description,
      chatRoles: row.chatRoles,
      isLead: row.isLead,
      hasKey: Boolean(row.apiKey),
      apiKeyHint: row.apiKeyHint,
    }));
}

export async function saveNayaAgent(workspaceId: string, profile: string, input: NayaAgentInput, actorId: string | null) {
  const name = profileName(profile);
  const values = {
    displayName: input.displayName,
    description: input.description ?? null,
    chatRoles: input.chatRoles,
    isLead: input.isLead,
    updatedAt: new Date(),
    ...(input.apiKey ? { apiKey: await encryptSecret(input.apiKey), apiKeyHint: input.apiKey.slice(-4) } : {}),
  };
  await db.transaction(async (tx) => {
    // One lead per workspace.
    if (input.isLead) await tx.update(nayaAgents).set({ isLead: false }).where(eq(nayaAgents.workspaceId, workspaceId));
    await tx
      .insert(nayaAgents)
      .values({ workspaceId, profile: name, createdBy: actorId, ...values })
      .onConflictDoUpdate({ target: [nayaAgents.workspaceId, nayaAgents.profile], set: values });
  });
  return (await listNayaAgents(workspaceId)).find((agent) => agent.profile === name)!;
}

export async function deleteNayaAgent(workspaceId: string, profile: string): Promise<boolean> {
  const rows = await db
    .delete(nayaAgents)
    .where(and(eq(nayaAgents.workspaceId, workspaceId), eq(nayaAgents.profile, profileName(profile))))
    .returning({ id: nayaAgents.id });
  return rows.length > 0;
}

/** The decrypted key of an agent the role may chat with, or an HttpError. */
export async function chatKey(workspaceId: string, profile: string, role: string | null): Promise<string> {
  const [row] = await db
    .select()
    .from(nayaAgents)
    .where(and(eq(nayaAgents.workspaceId, workspaceId), eq(nayaAgents.profile, profileName(profile))))
    .limit(1);
  if (!row) throw new HttpError(404, "Agent ini belum didaftarkan di daily (Pengaturan › AI › Agent Naya).");
  if (!role || !row.chatRoles.includes(role)) throw new HttpError(403, "Peran Anda tidak diizinkan chat dengan agent ini.");
  if (!row.apiKey) throw new HttpError(409, "API key Hermes untuk agent ini belum diisi.");
  try {
    return await decryptSecret(row.apiKey);
  } catch {
    throw new HttpError(409, "API key agent ini tidak bisa dibaca lagi (ENCRYPTION_KEY berubah). Isi ulang di Pengaturan.");
  }
}

/** What the person may do in Naya, for the UI to show or hide buttons (the API checks again). */
export function nayaPermissions(role: string | null, agents: NayaAgent[]) {
  return {
    instruct: nayaCan(role, "instruct"),
    review: nayaCan(role, "review"),
    comment: nayaCan(role, "comment"),
    manageAgents: role === "Owner" || role === "Admin",
    see: Object.fromEntries((Object.keys(NAYA_VIEWS) as NayaView[]).map((view) => [view, nayaSees(role, view)])) as Record<NayaView, boolean>,
    chat: agents.filter((agent) => agent.hasKey && !!role && agent.chatRoles.includes(role)).map((agent) => agent.profile),
    policy: NAYA_POLICY,
  };
}
