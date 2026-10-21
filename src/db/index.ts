import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { databaseTls } from "./tls";
const globalDb = globalThis as unknown as {
  conferenceDatabase?: ReturnType<typeof createDb>;
};
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const local = process.env.APP_ENV === "development";
  return drizzle(
    postgres(url, {
      ssl: databaseTls(url),
      max: local ? 1 : 2,
      prepare: local,
      idle_timeout: 20,
      connect_timeout: 15,
    }),
    {
      schema,
    },
  );
}
export function db() {
  return (globalDb.conferenceDatabase ??= createDb());
}
export type Database = ReturnType<typeof db>;
