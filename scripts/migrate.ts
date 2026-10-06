import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migracje zakończone.");
} finally {
  await client.end();
}
