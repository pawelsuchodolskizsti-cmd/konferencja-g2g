import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  emailLogs,
  events,
  participants,
  smtpSettings,
} from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { assert, AppError } from "./errors";
import { invitation } from "./mail";
import { smtpDiagnostic } from "./smtp-message";
import { sendSmtp, verifySmtp } from "./smtp-transport";

export const SMTP_ADDRESS = "konferencja@oneday.com.pl";
export const SMTP_HOST = "serwer1758522.home.pl";

function productionReady() {
  const url = process.env.APP_URL;
  let secureUrl = false;
  try {
    secureUrl = !!url && new URL(url).protocol === "https:";
  } catch {
    /* APP_URL musi być prawidłowy */
  }
  return (
    process.env.APP_ENV === "production" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production") &&
    secureUrl
  );
}
export async function smtpOverview(eventId: string) {
  const [account, people, logs, event] = await Promise.all([
    db()
      .select({ eventId: smtpSettings.eventId })
      .from(smtpSettings)
      .where(eq(smtpSettings.eventId, eventId)),
    db()
      .select({ id: participants.id, email: participants.email })
      .from(participants)
      .where(eq(participants.eventId, eventId)),
    db()
      .select({
        participantId: emailLogs.participantId,
        status: emailLogs.status,
        errorCode: emailLogs.errorCode,
        messageId: emailLogs.providerId,
        sentAt: emailLogs.sentAt,
        attemptedAt: emailLogs.firstAttemptAt,
        email: participants.email,
      })
      .from(emailLogs)
      .innerJoin(participants, eq(emailLogs.participantId, participants.id))
      .where(
        and(
          eq(participants.eventId, eventId),
          eq(emailLogs.kind, "INVITATION"),
        ),
      ),
    db()
      .select({
        mailSubject: events.mailSubject,
        mailBody: events.mailBody,
        mailFrom: events.mailFrom,
      })
      .from(events)
      .where(eq(events.id, eventId)),
  ]);
  assert(event[0], 404, "Brak wydarzenia.");
  const statuses = {
    queued: logs.filter((log) => log.status === "QUEUED").length,
    sending: logs.filter((log) => log.status === "SENDING").length,
    sent: logs.filter((log) => log.status === "SENT").length,
    errors: logs.filter((log) => log.status === "ERROR").length,
  };
  const emailCount = new Map<string, number>();
  people.forEach((p) =>
    emailCount.set(
      p.email.toLowerCase(),
      (emailCount.get(p.email.toLowerCase()) || 0) + 1,
    ),
  );
  const duplicateEmailAddresses = [...emailCount.values()].filter(
    (count) => count > 1,
  ).length;
  return {
    host: SMTP_HOST,
    port: 465,
    username: SMTP_ADDRESS,
    passwordSaved: account.length > 0,
    productionReady: productionReady(),
    senderValid: event[0].mailFrom.toLowerCase() === SMTP_ADDRESS,
    total: people.length,
    uniqueEmails: emailCount.size,
    duplicateEmailAddresses,
    duplicateRecipients: people.length - emailCount.size,
    ...statuses,
    diagnostics: logs,
    notQueued: people.length - logs.length,
    subject: event[0].mailSubject,
    body: event[0].mailBody,
  };
}
export async function saveSmtpPassword(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const { password } = z
    .object({ password: z.string().min(1).max(512) })
    .parse(input);
  await db().transaction(async (tx) => {
    await tx
      .insert(smtpSettings)
      .values({ eventId, passwordEncrypted: encrypt(password) })
      .onConflictDoUpdate({
        target: smtpSettings.eventId,
        set: { passwordEncrypted: encrypt(password), updatedAt: new Date() },
      });
    await tx
      .insert(auditLogs)
      .values({ eventId, adminId, action: "SMTP_SETTINGS_SAVED" });
  });
  return { saved: true };
}
export async function removeSmtpPassword(eventId: string, adminId: string) {
  await db().transaction(async (tx) => {
    await tx.delete(smtpSettings).where(eq(smtpSettings.eventId, eventId));
    await tx
      .insert(auditLogs)
      .values({ eventId, adminId, action: "SMTP_SETTINGS_REMOVED" });
  });
  return { saved: true };
}
export async function saveSmtpTemplate(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const value = z
    .object({
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(10).max(10000),
    })
    .parse(input);
  await db().transaction(async (tx) => {
    await tx
      .update(events)
      .set({ mailSubject: value.subject, mailBody: value.body })
      .where(eq(events.id, eventId));
    await tx
      .insert(auditLogs)
      .values({ eventId, adminId, action: "SMTP_TEMPLATE_SAVED" });
  });
  return { saved: true };
}
async function assertSmtpReady(eventId: string) {
  assert(
    productionReady(),
    503,
    "Wysyłka działa wyłącznie w produkcji z adresem APP_URL HTTPS.",
  );
  const [[config], [event]] = await Promise.all([
    db().select().from(smtpSettings).where(eq(smtpSettings.eventId, eventId)),
    db().select().from(events).where(eq(events.id, eventId)),
  ]);
  assert(config, 503, "Najpierw zapisz hasło skrzynki SMTP.");
  assert(
    event && event.mailFrom.toLowerCase() === SMTP_ADDRESS,
    409,
    "Adres nadawcy musi odpowiadać skrzynce SMTP.",
  );
  return { password: decrypt(config.passwordEncrypted), event };
}
export async function checkSmtpCredentials(eventId: string) {
  const { password } = await assertSmtpReady(eventId);
  try {
    await verifySmtp(password);
    return { connected: true };
  } catch {
    throw new AppError(
      502,
      "Nie udało się uwierzytelnić w SMTP. Sprawdź hasło i połączenie z serwerem.",
    );
  }
}
// Przygotowanie kolejki nie wysyła wiadomości. Dwa rekordy z tym samym adresem
// otrzymują dwa osobne zadania dzięki rozróżnieniu po participantId.
export async function startSmtpCampaign(eventId: string, adminId: string) {
  await assertSmtpReady(eventId);
  return db().transaction(async (tx) => {
    const people = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.eventId, eventId));
    assert(people.length, 400, "Brak uczestników do wysyłki.");
    const inserted = await tx
      .insert(emailLogs)
      .values(
        people.map((person) => ({
          participantId: person.id,
          kind: "INVITATION" as const,
          adminId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: emailLogs.id });
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "SMTP_CAMPAIGN_QUEUED",
      targetId: eventId,
    });
    return { queued: inserted.length };
  });
}
// Wiadomość po niejednoznacznym błędzie nie jest ponawiana samoczynnie.
// To zapobiega przypadkowemu wysłaniu drugiej wiadomości przy zerwaniu sieci.
async function claimNext(eventId: string) {
  return db().transaction(async (tx) => {
    const [match] = await tx
      .select({ mail: emailLogs })
      .from(emailLogs)
      .innerJoin(participants, eq(participants.id, emailLogs.participantId))
      .where(
        and(
          eq(participants.eventId, eventId),
          eq(emailLogs.kind, "INVITATION"),
          eq(emailLogs.status, "QUEUED"),
          lt(emailLogs.nextAttemptAt, new Date(Date.now() + 1000)),
        ),
      )
      .orderBy(emailLogs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!match) return null;
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(emailLogs)
      .set({
        status: "SENDING",
        leaseToken,
        leaseUntil: new Date(Date.now() + 120000),
        firstAttemptAt: new Date(),
        attempts: match.mail.attempts + 1,
      })
      .where(eq(emailLogs.id, match.mail.id))
      .returning();
    return claimed;
  });
}
export async function processSmtpBatch(eventId: string, adminId: string) {
  const { password, event } = await assertSmtpReady(eventId);
  // Nie dotykamy starych SENDING: wynik SMTP może być niejednoznaczny.
  const stale = await db()
    .select({ mail: emailLogs })
    .from(emailLogs)
    .innerJoin(participants, eq(participants.id, emailLogs.participantId))
    .where(
      and(
        eq(participants.eventId, eventId),
        eq(emailLogs.kind, "INVITATION"),
        eq(emailLogs.status, "SENDING"),
        lt(emailLogs.leaseUntil, new Date()),
      ),
    );
  for (const { mail } of stale) {
    await db()
      .update(emailLogs)
      .set({
        status: "ERROR",
        errorCode: "REVIEW_REQUIRED",
        leaseToken: null,
        leaseUntil: null,
      })
      .where(and(eq(emailLogs.id, mail.id), eq(emailLogs.status, "SENDING")));
  }
  let sent = 0,
    errors = 0;
  const started = Date.now();
  for (let i = 0; i < 5 && Date.now() - started < 20000; i++) {
    const mail = await claimNext(eventId);
    if (!mail) break;
    try {
      const [person] = await db()
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.id, mail.participantId),
            eq(participants.eventId, eventId),
          ),
        );
      assert(person, 404, "Nie znaleziono uczestnika.");
      const payload = await invitation(person, event);
      const messageId = `<invitation-${mail.id}@oneday.com.pl>`;
      await db()
        .update(emailLogs)
        .set({ providerId: messageId })
        .where(
          and(
            eq(emailLogs.id, mail.id),
            eq(emailLogs.leaseToken, mail.leaseToken!),
          ),
        );
      await sendSmtp(payload, password, messageId);
      await db().transaction(async (tx) => {
        await tx
          .update(emailLogs)
          .set({
            status: "SENT",
            sentAt: new Date(),
            errorCode: null,
            leaseToken: null,
            leaseUntil: null,
          })
          .where(
            and(
              eq(emailLogs.id, mail.id),
              eq(emailLogs.leaseToken, mail.leaseToken!),
            ),
          );
        await tx
          .insert(auditLogs)
          .values({
            eventId,
            adminId,
            action: "SMTP_EMAIL_ACCEPTED",
            targetId: mail.id,
          });
      });
      sent++;
    } catch (error) {
      await db()
        .update(emailLogs)
        .set({
          status: "ERROR",
          errorCode: smtpDiagnostic(error),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(emailLogs.id, mail.id),
            eq(emailLogs.leaseToken, mail.leaseToken!),
          ),
        );
      errors++;
      break; // Nie kontynuuj kampanii, gdy serwer pocztowy zgłasza błąd.
    }
    if (process.env.NODE_ENV !== "test")
      await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return { sent, errors };
}
