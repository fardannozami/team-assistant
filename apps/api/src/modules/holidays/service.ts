import {
  createDbClient,
  holidays,
  calendarSettings,
  calendarExceptions,
} from "@repo/database";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const HOLIDAY_API_URL =
  process.env.HOLIDAY_API_URL ?? "https://date.nager.at/api/v3/PublicHolidays";

export async function getCalendarSettings() {
  const [row] = await db.select().from(calendarSettings).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(calendarSettings)
    .values({ country: "ID", timezone: DEFAULT_TIMEZONE })
    .returning();
  return created!;
}

export async function updateCalendarSettings(
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
  const existing = await getCalendarSettings();
  const existingId = existing!.id;
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
    .where(eq(calendarSettings.id, existingId))
    .returning();
  await audit(actorId ?? null, "calendar.settings.update", "calendar_settings", existingId, patch);
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

export async function syncHolidays(
  year: number = new Date().getFullYear(),
  actorId?: string | null,
) {
  const url = `${HOLIDAY_API_URL}/${year}/ID`;
  let data: any[] = [];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Holiday API failed: ${res.status}`);
    data = (await res.json()) as any[];
  } catch (err) {
    // Retain last successful dataset: do not wipe.
    throw new HttpError(400, `Failed to sync holidays: ${(err as Error).message}`);
  }

  // Remove existing national holidays for that year before re-inserting.
  await db
    .delete(holidays)
    .where(
      and(
        eq(holidays.type, "national"),
        gte(holidays.date, `${year}-01-01`),
        lte(holidays.date, `${year}-12-31`),
      ),
    );

  const inserted = [];
  for (const entry of data) {
    const date = entry.date;
    const name = entry.localName ?? entry.name ?? "Holiday";
    const isJoint =
      /cuti bersama/i.test(name) || (Array.isArray(entry.types) && entry.types.includes("Joint"));
    const type = isJoint ? "joint" : "national";
    const [row] = await db
      .insert(holidays)
      .values({ date, name, type, source: url })
      .returning();
    if (row) inserted.push(row);
  }

  await audit(actorId ?? null, "holiday.sync", "holidays", undefined, {
    year,
    count: inserted.length,
    source: url,
  });
  return { year, synced: inserted.length, holidays: inserted };
}

export async function listExceptions() {
  return db.select().from(calendarExceptions).orderBy(asc(calendarExceptions.date));
}

export async function createException(
  input: { date: string; reason?: string; skip?: boolean },
  actorId?: string | null,
) {
  const [created] = await db
    .insert(calendarExceptions)
    .values({
      date: input.date,
      reason: input.reason ?? null,
      skip: input.skip ?? true,
    })
    .returning();
  await audit(actorId ?? null, "calendar.exception.create", "calendar_exception", created!.id, input);
  return created!;
}

export async function deleteException(id: string, actorId?: string | null) {
  const [existing] = await db
    .select()
    .from(calendarExceptions)
    .where(eq(calendarExceptions.id, id))
    .limit(1);
  if (!existing) throw new HttpError(404, "Exception not found");
  await db.delete(calendarExceptions).where(eq(calendarExceptions.id, id));
  await audit(actorId ?? null, "calendar.exception.delete", "calendar_exception", id, {
    date: existing.date,
  });
}

export async function isExcludedDate(date: string): Promise<{ excluded: boolean; reason?: string }> {
  const settings = await getCalendarSettings();
  const s = settings!;
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

  // Weekend check
  if (s.skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return { excluded: true, reason: "weekend" };
  }

  // Manual exceptions
  const [exception] = await db
    .select()
    .from(calendarExceptions)
    .where(eq(calendarExceptions.date, date))
    .limit(1);
  if (exception) {
    if (exception.skip) return { excluded: true, reason: exception.reason ?? "manual exception" };
    return { excluded: false, reason: exception.reason ?? "manual override (not skipped)" };
  }

  // Holidays
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
  daysAhead: number = 7,
  send?: (phone: string, text: string) => Promise<void>,
) {
  // Lazy import to avoid circular deps
  const { listEmployees } = await import("../employees/service.js");
  const { sendText } = await import("../whatsapp/service.js");
  const sender = send ?? sendText;

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

  const admins = (await listEmployees()).filter((e: any) => e.roleName && ["Owner", "Admin"].includes(e.roleName));
  // employees may not have phone? they do
  let sent = 0;
  const text = [
    `Upcoming holidays (next ${daysAhead} days):`,
    ...upcoming.map((h) => `- ${h.date}: ${h.name} (${h.type})`),
  ].join("\n");

  for (const admin of admins) {
    try {
      await sender((admin as any).phone, text);
      sent++;
    } catch {
      // ignore
    }
  }
  return { sent, holidays: upcoming };
}