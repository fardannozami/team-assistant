import { createDbClient } from "./client.js";
import { roles, permissions, users, schedules } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant";

async function seed() {
  const db = createDbClient(databaseUrl);

  const defaultRoles = ["Owner", "Admin", "Manager", "Employee"];
  for (const name of defaultRoles) {
    await db.insert(roles).values({ name }).onConflictDoNothing();
  }

  const defaultPermissions = [
    "employee:manage",
    "schedule:manage",
    "report:view",
    "standup:trigger",
    "integration:manage",
    "audit:view",
  ];
  for (const name of defaultPermissions) {
    await db.insert(permissions).values({ name }).onConflictDoNothing();
  }

  // Default standup schedule: admins can change it at runtime; this is the
  // factory default used when they have not configured one.
  await db
    .insert(schedules)
    .values({
      name: "standup",
      timeOfDay: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "Asia/Jakarta",
      reminderMinutes: 90,
      isActive: true,
    })
    .onConflictDoNothing({ target: schedules.name });

  console.log("Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
