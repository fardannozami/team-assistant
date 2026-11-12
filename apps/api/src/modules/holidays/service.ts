import {
  createDbClient,
  holidays,
  calendarSettings,
  calendarExceptions,
} from "@repo/database";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import {
  dateInTimezone,
  DEFAULT_TIMEZONE,
  normalizePhoneNumber,
} from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const HOLIDAY_API_URL =
  process.env.HOLIDAY_API_URL ?? "https://tanggalmerah.upset.dev/api/holidays";

async function selectCalendarSettings(workspaceId: string) {
  const [row] = await db
    .select()
    .from(calendarSettings)
    .where(eq(calendarSettings.workspaceId, workspaceId))
    .limit(1);
  return row;
}

export async function getCalendarSettings(workspaceId: string) {
  const row = await selectCalendarSettings(workspaceId);
  if (row) return row;
  // createWorkspace seeds this row; fall back for older workspaces. A
  // concurrent insert is fine: conflict on workspaceId, then re-select.
  await db
    .insert(calendarSettings)
    .values({ workspaceId, country: "ID", timezone: DEFAULT_TIMEZONE })
    .onConflictDoNothing({ target: calendarSettings.workspaceId });
  const created = await selectCalendarSettings(workspaceId);
  if (!created) throw new Error("Failed to create calendar settings");
  return created;
}

export async function updateCalendarSettings(
  workspaceId: string,
  patch: {
    country?: string;
    timezone?: string;
    skipWeekends?: boolean;
    skipNationalHolidays?: boolean;
    skipJointHolidays?: boolean;
    config?: unknown;
  },
  actorId?: string | null,
) {
  const existing = await getCalendarSettings(workspaceId);
  const existingId = existing.id;
  const changes: Partial<typeof calendarSettings.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.country !== undefined) changes.country = patch.country;
  if (patch.timezone !== undefined) changes.timezone = patch.timezone;
  if (patch.skipWeekends !== undefined) changes.skipWeekends = patch.skipWeekends;
  if (patch.skipNationalHolidays !== undefined)
    changes.skipNationalHolidays = patch.skipNationalHolidays;
  if (patch.skipJointHolidays !== undefined)
    changes.skipJointHolidays = patch.skipJointHolidays;
  if (patch.config !== undefined) changes.config = patch.config as any;

  const [updated] = await db
    .update(calendarSettings)
    .set(changes)
    .where(
      and(
        eq(calendarSettings.id, existingId),
        eq(calendarSettings.workspaceId, workspaceId),
      ),
    )
    .returning();
  await audit(
    workspaceId,
    actorId ?? null,
    "calendar.settings.update",
    "calendar_settings",
    existingId,
    patch,
  );
  return updated!;
}

export async function listHolidays(filters: { year?: number; type?: string } = {}) {
  const conditions = [];
  if (filters.type) conditions.push(eq(holidays.type, filters.type));
  if (filters.year) {
    conditions.push(gte(holidays.date, `${filters.year}-01-01`));
    conditions.push(lte(holidays.date, `${filters.year}-12-31`));
  }
  return db
    .select()
    .from(holidays)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(holidays.date));
}

export async function listUpcomingHolidays(limit = 10, from?: string) {
  const start = from ?? dateInTimezone();
  return db
    .select()
    .from(holidays)
    .where(gte(holidays.date, start))
    .orderBy(asc(holidays.date))
    .limit(limit);
}

/**
 * Holidays are global (public data); `workspaceId` only attributes the audit
 * entry to the workspace that triggered the sync.
 */
export async function syncHolidays(
  year: number = new Date().getFullYear(),
  actorId?: string | null,
  workspaceId: string | null = null,
) {
  const url = `${HOLIDAY_API_URL}?year=${year}`;
  let data: any[] = [];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Holiday API failed: ${res.status}`);
    const body = (await res.json()) as any;
    data = Array.isArray(body) ? body : (body.data ?? []);
  } catch (err) {
    // Retain last successful dataset: do not wipe.
    throw new HttpError(400, `Failed to sync holidays: ${(err as Error).message}`);
  }

  // Replace both national and joint rows for that year with fresh data. The
  // table is shared by every workspace, so swap atomically: readers never see
  // an empty year.
  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(holidays)
      .where(and(gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`)));

    const rows = [];
    for (const entry of data) {
      const date = entry.date;
      const name = entry.localName ?? entry.name ?? "Holiday";
      const isJoint =
        entry.type === "leave" ||
        /cuti bersama/i.test(name) ||
        (Array.isArray(entry.types) && entry.types.includes("Joint"));
      const type = isJoint ? "joint" : "national";
      const [row] = await tx
        .insert(holidays)
        .values({ date, name, type, source: url })
        .returning();
      if (row) rows.push(row);
    }
    return rows;
  });

  await audit(workspaceId, actorId ?? null, "holiday.sync", "holidays", undefined, {
    year,
    count: inserted.length,
    source: url,
  });
  return { year, synced: inserted.length, holidays: inserted };
}

export async function listExceptions(workspaceId: string) {
  return db
    .select()
    .from(calendarExceptions)
    .where(eq(calendarExceptions.workspaceId, workspaceId))
    .orderBy(asc(calendarExceptions.date));
}

export async function createException(
  workspaceId: string,
  input: { date: string; reason?: string; skip?: boolean },
  actorId?: string | null,
) {
  const [created] = await db
    .insert(calendarExceptions)
    .values({
      workspaceId,
      date: input.date,
      reason: input.reason ?? null,
      skip: input.skip ?? true,
    })
    .returning();
  await audit(
    workspaceId,
    actorId ?? null,
    "calendar.exception.create",
    "calendar_exception",
    created!.id,
    input,
  );
  return created!;
}

export async function deleteException(
  workspaceId: string,
  id: string,
  actorId?: string | null,
) {
  const where = and(
    eq(calendarExceptions.id, id),
    eq(calendarExceptions.workspaceId, workspaceId),
  );
  const [existing] = await db
    .select()
    .from(calendarExceptions)
    .where(where)
    .limit(1);
  if (!existing) throw new HttpError(404, "Exception not found");
  await db.delete(calendarExceptions).where(where);
  await audit(
    workspaceId,
    actorId ?? null,
    "calendar.exception.delete",
    "calendar_exception",
    id,
    { date: existing.date },
  );
}

export async function isExcludedDate(
  workspaceId: string,
  date: string,
): Promise<{ excluded: boolean; reason?: string }> {
  const s = await getCalendarSettings(workspaceId);
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

  // Weekend check
  if (s.skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return { excluded: true, reason: "weekend" };
  }

  // Manual exceptions
  const [exception] = await db
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.workspaceId, workspaceId),
        eq(calendarExceptions.date, date),
      ),
    )
    .limit(1);
  if (exception) {
    if (exception.skip) return { excluded: true, reason: exception.reason ?? "manual exception" };
    return { excluded: false, reason: exception.reason ?? "manual override (not skipped)" };
  }

  // Holidays (global)
  const holidayRows = await db
    .select()
    .from(holidays)
    .where(eq(holidays.date, date));
  for (const h of holidayRows) {
    if (h.type === "national" && s.skipNationalHolidays) {
      return { excluded: true, reason: `national holiday: ${h.name}` };
    }
    if (h.type === "joint" && s.skipJointHolidays) {
      return { excluded: true, reason: `joint leave: ${h.name}` };
    }
  }

  return { excluded: false };
}

export async function notifyAdminsBeforeHolidays(
  workspaceId: string,
  daysAhead: number = 7,
) {
  // Lazy import to avoid circular deps
  const { listEmployees } = await import("../employees/service.js");
  const { sendText } = await import("../whatsapp/service.js");

  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + daysAhead);
  const startStr = dateInTimezone();
  const endStr = dateInTimezone(DEFAULT_TIMEZONE, end);

  const upcoming = await db
    .select()
    .from(holidays)
    .where(and(gte(holidays.date, startStr), lte(holidays.date, endStr)))
    .orderBy(asc(holidays.date));

  if (upcoming.length === 0) return { sent: 0, holidays: [] };

  const admins = (await listEmployees(workspaceId, { active: true })).filter(
    (e) => e.roleName && ["Owner", "Admin"].includes(e.roleName),
  );
  let sent = 0;
  const text = [
    `Upcoming holidays (next ${daysAhead} days):`,
    ...upcoming.map((h) => `- ${h.date}: ${h.name} (${h.type})`),
  ].join("\n");

  for (const admin of admins) {
    try {
      await sendText(
        workspaceId,
        `${normalizePhoneNumber(admin.phone)}@s.whatsapp.net`,
        text,
      );
      sent++;
    } catch {
      // ignore
    }
  }
  return { sent, holidays: upcoming };
}