import { test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import type { Database } from "../src/db";
const fixture = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db", () => ({ db: () => fixture.db }));
vi.mock("../src/server/smtp-transport", () => ({
  sendSmtp: vi.fn(),
  verifySmtp: vi.fn(),
}));
import { newCredentials } from "../src/server/crypto";
import { markTestParticipants } from "../scripts/mark-test-participants";
import {
  participantList,
  eventOverview,
  exportAttendance,
} from "../src/server/admin-data";
import { exportReport } from "../src/server/admin-operations";
import { queueInvitations, queueCertificate } from "../src/server/mail";
import {
  smtpOverview,
  startSmtpCampaign,
  saveSmtpPassword,
  processSmtpBatch,
} from "../src/server/smtp-campaign";
import { sendSmtp } from "../src/server/smtp-transport";

test("marked accounts remain usable but are excluded from reports, totals and campaigns even after editing", async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "synthetic".repeat(8);
  process.env.APP_ENV = "production";
  process.env.APP_URL = "https://conference.example.test";
  const pg = new PGlite();
  const database = drizzle(pg, { schema: s });
  fixture.db = database as unknown as Database;
  try {
    await migrate(database, { migrationsFolder: "./drizzle" });
    const [admin] = await database
      .insert(s.admins)
      .values({ email: "admin@example.test", passwordHash: "unused" })
      .returning();
    const [event] = await database
      .insert(s.events)
      .values({
        slug: "test-accounts",
        name: "Synthetic",
        organizer: "Test",
        location: "Local",
        startsAt: new Date(0),
        endsAt: new Date(1),
        certificateUnlockAt: new Date(1),
        mailFrom: "konferencja@oneday.com.pl",
      })
      .returning();
    const people = await database
      .insert(s.participants)
      .values(
        [
          "g2g.test.001453@example.com",
          "prezentacja.g2g@example.com",
          "ordinary@example.test",
        ].map((email, i) => ({
          eventId: event.id,
          firstName: `Person${i}`,
          lastName: "Synthetic",
          email,
          ...newCredentials(),
        })),
      )
      .returning();
    expect(await markTestParticipants(fixture.db!)).toEqual({ marked: 2 });
    expect(await markTestParticipants(fixture.db!)).toEqual({ marked: 0 });
    expect(await participantList(event.id)).toHaveLength(1);
    const overview = await eventOverview(event.id);
    expect(overview.people).toHaveLength(3);
    expect(overview.people.filter((p) => p.isTest)).toHaveLength(2);
    for (const kind of ["attendance", "privacy", "certificates"]) {
      const csv = await (
        await exportReport(event.id, admin.id, kind, {})
      ).text();
      expect(csv).not.toContain("Person0");
      expect(csv).not.toContain("Person1");
    }
    expect(await (await exportAttendance(event.id)).text()).toContain(
      "ordinary@example.test",
    );
    await database
      .update(s.participants)
      .set({ email: "changed@example.test" })
      .where(eq(s.participants.id, people[0].id));
    expect(await participantList(event.id)).toHaveLength(1);
    expect(await queueInvitations(event.id, admin.id, fixture.db!)).toEqual({
      queued: 1,
    });
    await expect(queueCertificate(people[0].id)).rejects.toThrow(
      "Konto testowe",
    );
    await saveSmtpPassword(event.id, admin.id, { password: "synthetic-only" });
    expect(await startSmtpCampaign(event.id, admin.id)).toEqual({ queued: 0 });
    await database
      .insert(s.emailLogs)
      .values({ participantId: people[0].id, kind: "INVITATION" });
    expect((await smtpOverview(event.id)).total).toBe(1);
    expect((await smtpOverview(event.id)).diagnostics).toHaveLength(1);
    // Leave only an old test-account job pending and prove it never reaches SMTP.
    await database
      .update(s.emailLogs)
      .set({ status: "SENT" })
      .where(eq(s.emailLogs.participantId, people[2].id));
    expect((await processSmtpBatch(event.id, admin.id)).sent).toBe(0);
    expect(sendSmtp).not.toHaveBeenCalled();
    expect(await database.select().from(s.participants)).toHaveLength(3);
    expect(
      (
        await database
          .select()
          .from(s.participants)
          .where(eq(s.participants.id, people[0].id))
      )[0].credentials,
    ).toBe(people[0].credentials);
  } finally {
    await pg.close();
  }
});
