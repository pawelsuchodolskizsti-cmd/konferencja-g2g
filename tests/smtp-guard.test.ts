import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as s from "../src/db/schema";
const fixture = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db", () => ({ db: () => fixture.database }));
import { claimSingleSmtp } from "../src/server/smtp-guard";
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string, adminId: string;
beforeAll(async () => {
  fixture.database = database;
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  const [admin] = await database
    .insert(s.admins)
    .values({ email: "admin@example.org", passwordHash: "unused" })
    .returning();
  adminId = admin.id;
  const [event] = await database
    .insert(s.events)
    .values({
      slug: "guard",
      name: "Guard",
      organizer: "Test",
      location: "Test",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600000),
      certificateUnlockAt: new Date(Date.now() + 3600000),
      mailFrom: "konferencja@oneday.com.pl",
    })
    .returning();
  eventId = event.id;
});
afterAll(async () => {
  vi.useRealTimers();
  await pg.close();
});
test("server guard shares account and mailbox limits, blocks duplicate content and preserves replay", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.now();
  vi.setSystemTime(now);
  const input = {
    eventId,
    adminId,
    requestId: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    action: "SMTP_TEST_STARTED",
    to: "first@example.org",
    cc: "second@example.org",
    content: "reminder",
  };
  expect((await claimSingleSmtp(input)).state).toBe("CLAIMED");
  expect((await claimSingleSmtp(input)).state).toBe("REPLAY");
  expect(
    (await claimSingleSmtp({ ...input, requestId: crypto.randomUUID() })).state,
  ).toBe("DUPLICATE");
  const other = {
    ...input,
    requestId: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    to: "other@example.org",
    cc: undefined,
  };
  expect(await claimSingleSmtp(other)).toMatchObject({
    state: "WAIT",
    retryAfterMs: 3000,
  });
  vi.setSystemTime(now + 3001);
  expect(
    (await claimSingleSmtp({ ...other, to: "second@example.org" })).state,
  ).toBe("WAIT");
  expect((await claimSingleSmtp(other)).state).toBe("CLAIMED");
  vi.setSystemTime(now + 30001);
  expect(
    (
      await claimSingleSmtp({
        ...input,
        requestId: crypto.randomUUID(),
        content: "different reminder",
      })
    ).state,
  ).toBe("CLAIMED");
  vi.setSystemTime(now + 600001);
  expect(
    (await claimSingleSmtp({ ...input, requestId: crypto.randomUUID() })).state,
  ).toBe("CLAIMED");
});
