import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseTls } from "../src/db/tls";
import * as schema from "../src/db/schema";
import { migrateParticipantPii } from "../src/db/migrate-pii";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const client = postgres(process.env.DATABASE_URL, {
  max: 1,
  ssl: databaseTls(process.env.DATABASE_URL),
});
try {
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: "./drizzle" });
  console.log(
    "PII encryption verified:",
    JSON.stringify(await migrateParticipantPii(database)),
  );
  console.log("Migracje zakończone.");
} finally {
  await client.end();
}
