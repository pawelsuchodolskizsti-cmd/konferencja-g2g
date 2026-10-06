import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { admins } from "../src/db/schema";
import { passwordHash } from "../src/server/crypto";
import { z } from "zod";
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = z.string().min(14).max(128).parse(process.env.ADMIN_PASSWORD);
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await drizzle(client)
    .insert(admins)
    .values({ email, passwordHash: passwordHash(password) });
  console.log("Administrator utworzony.");
} finally {
  await client.end();
}
