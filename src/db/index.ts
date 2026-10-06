import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
const globalDb = globalThis as unknown as {
  conferenceDatabase?: ReturnType<typeof createDb>;
};
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const local = process.env.APP_ENV === "development";
  return drizzle(postgres(url, { max: local ? 1 : 5, prepare: local }), {
    schema,
  });
}
export function db() {
  return (globalDb.conferenceDatabase ??= createDb());
}
export type Database = ReturnType<typeof db>;
