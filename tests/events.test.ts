import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as schema from "../src/db/schema";
const pg = new PGlite();
const database = drizzle(pg);
vi.mock("@/db", () => ({ db: () => database }));
vi.mock("../src/server/auth", () => ({ requireEvent: vi.fn() }));
import { saveEvent, eventInput } from "../src/server/events";
let adminId: string;
beforeAll(async () => {
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0011_secondary_email.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0005_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0006_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0009_courses_unlock.sql", "utf8"));
  const [admin] = await database
    .insert(schema.admins)
    .values({ email: "single@example.org", passwordHash: "unused" })
    .returning();
  adminId = admin.id;
});
afterAll(async () => pg.close());
test("agenda rejects reversed and equal times with an error on the affected row", () => {
  const slot = {
    title: "Warsztat",
    speaker: "Anna",
    start: "15:00",
    end: "16:00",
  };
  expect(eventInput.shape.agenda.safeParse([slot]).success).toBe(true);
  for (const end of ["14:00", "15:00"]) {
    const result = eventInput.shape.agenda.safeParse([slot, { ...slot, end }]);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].path).toEqual([1, "end"]);
  }
});
test("configuration creates only one conference and preserves its identity on edit", async () => {
  const input = {
    name: "Inna nazwa",
    slug: "inna-nazwa",
    organizer: "Fundacja",
    location: "Sala",
    startsAt: "2027-01-01T09:00:00Z",
    endsAt: "2027-01-01T17:00:00Z",
    certificateUnlockAt: "2027-01-01T17:00:00Z",
    timezone: "Europe/Warsaw",
    mailFrom: "test@example.org",
    mailSubject: "Zaproszenie",
    mailBody: "Zapraszamy na konferencję.",
    info: "",
    published: false,
    retentionUntil: null,
    agenda: [],
  };
  const event = await saveEvent(adminId, input);
  expect(event.name).toBe("Głowa do Góry");
  expect(event.slug).toBe("glowa-do-gory");
  await expect(saveEvent(adminId, input)).rejects.toMatchObject({
    status: 409,
  });
  const updated = await saveEvent(
    adminId,
    { ...input, location: "Nowa sala" },
    event.id,
  );
  expect(updated.slug).toBe(event.slug);
  expect(updated.name).toBe(event.name);
  expect(updated.location).toBe("Nowa sala");
  expect(await database.select().from(schema.events)).toHaveLength(1);
});
