import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as s from "../src/db/schema.ts";
import { passwordHash } from "../src/server/crypto.ts";
await mkdir(".local", { recursive: true });
let config;
try {
  config = JSON.parse(await readFile(".local/access.json", "utf8"));
} catch {
  config = {
    email: "admin@example.test",
    password: randomBytes(18).toString("base64url"),
  };
  await writeFile(".local/access.json", JSON.stringify(config));
}
try {
  await readFile(".env.local");
} catch {
  await writeFile(
    ".env.local",
    `APP_ENV=development\nAPP_URL=http://localhost:3000\nDATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres\nDATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nTOKEN_PEPPER=${randomBytes(32).toString("hex")}\nCRON_SECRET=${randomBytes(32).toString("hex")}\nMAIL_ENABLED=false\n`,
  );
}
const client = postgres(
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres",
  { max: 1 },
);
try {
  const database = drizzle(client);
  await migrate(database, { migrationsFolder: "./drizzle" });
  await database
    .insert(s.admins)
    .values({
      email: config.email,
      passwordHash: passwordHash(config.password),
    })
    .onConflictDoNothing();
  console.log(
    "Środowisko lokalne gotowe. Dane logowania: .local/access.json. Wysyłka maili wyłączona.",
  );
} finally {
  await client.end();
}
