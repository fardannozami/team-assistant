import { createDbClient } from "./client.js";
import { roles, permissions } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant";

async function seed() {
  const db = createDbClient(databaseUrl);

  // Roles and permissions are global. Workspaces (with their default
  // schedule and calendar settings) are created on sign-up via createWorkspace.

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

  console.log("Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
