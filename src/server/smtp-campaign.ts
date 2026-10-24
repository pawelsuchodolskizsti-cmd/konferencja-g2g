import "server-only";
import { claimSingleSmtp } from "./smtp-guard";
import {
  mailAddresses,
  participantMailRecipients,
} from "@/lib/mail-recipients";
import { realParticipant } from "./participant-scope";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  emailLogs,
  events,
  participants,
  rateLimits,
  smtpSettings,
} from "@/db/schema";
import { participantIdentity } from "@/lib/participant-identity";
import { decrypt, encrypt } from "./crypto";
import { assert, AppError } from "./errors";
import { invitation } from "./mail";
import { smtpDiagnostic, smtpRetryDelay, SmtpFailure } from "./smtp-message";
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
      .select({
        id: participants.id,
        email: participants.email,
        secondaryEmail: participants.secondaryEmail,
      })
      .from(participants)
      .where(and(eq(participants.eventId, eventId), realParticipant)),
    db()
      .select({
        participantId: emailLogs.participantId,
        status: emailLogs.status,
        errorCode: emailLogs.errorCode,
        messageId: emailLogs.providerId,
        sentAt: emailLogs.sentAt,
        attemptedAt: emailLogs.firstAttemptAt,
        email: participants.email,
        secondaryEmail: participants.secondaryEmail,
      })
      .from(emailLogs)
      .innerJoin(participants, eq(emailLogs.participantId, participants.id))
      .where(
        and(
          eq(participants.eventId, eventId),
          realParticipant,
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
  const addresses = people.flatMap((p) =>
    mailAddresses(participantMailRecipients(p)),
  );
  addresses.forEach((email) =>
    emailCount.set(email, (emailCount.get(email) || 0) + 1),
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
    duplicateRecipients: addresses.length - emailCount.size,
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
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    const people = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.eventId, eventId), realParticipant));
    assert(people.length, 400, "Brak uczestników do wysyłki.");
    const prior = await tx
      .select({ person: participants })
      .from(emailLogs)
      .innerJoin(participants, eq(participants.id, emailLogs.participantId))
      .where(
        and(
          eq(participants.eventId, eventId),
          realParticipant,
          eq(emailLogs.kind, "INVITATION"),
        ),
      );
    const seen = new Set(
      prior.map(({ person }) => participantIdentity(person)),
    );
    const fresh = people.filter((person) => {
      const key = participantIdentity(person);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) return { queued: 0 };
    const inserted = await tx
      .insert(emailLogs)
      .values(
        fresh.map((person) => ({
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
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    const [match] = await tx
      .select({ mail: emailLogs })
      .from(emailLogs)
      .innerJoin(participants, eq(participants.id, emailLogs.participantId))
      .where(
        and(
          eq(participants.eventId, eventId),
          realParticipant,
          eq(emailLogs.kind, "INVITATION"),
          eq(emailLogs.status, "QUEUED"),
        ),
      )
      .orderBy(emailLogs.nextAttemptAt, emailLogs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!match) return null;
    const scheduledWait = match.mail.nextAttemptAt.getTime() - Date.now();
    if (scheduledWait > 0) return { retryAfterMs: scheduledWait };
    const [person] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, match.mail.participantId));
    const prior = await tx
      .select({ person: participants, mail: emailLogs })
      .from(emailLogs)
      .innerJoin(participants, eq(participants.id, emailLogs.participantId))
      .where(
        and(
          eq(participants.eventId, eventId),
          realParticipant,
          eq(emailLogs.kind, "INVITATION"),
        ),
      );
    if (
      prior.some(
        (entry) =>
          entry.mail.id !== match.mail.id &&
          (entry.mail.status !== "QUEUED" ||
            entry.mail.firstAttemptAt !== null) &&
          participantIdentity(entry.person) === participantIdentity(person),
      )
    ) {
      await tx
        .update(emailLogs)
        .set({ status: "ERROR", errorCode: "DUPLICATE_PARTICIPANT_BLOCKED" })
        .where(eq(emailLogs.id, match.mail.id));
      return { retryAfterMs: 1 };
    }
    // One database lock for this SMTP account across events, tabs and workers.
    // No network calls while holding it. Expired entries can use normal cleanup.
    const globalKey = `smtp:dispatch:${SMTP_ADDRESS}`;
    const [globalLimit] = await tx
      .insert(rateLimits)
      .values({
        key: globalKey,
        count: 0,
        resetsAt: new Date(0),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: sql`${rateLimits.count}` },
      })
      .returning();
    const now = Date.now();
    if (globalLimit.resetsAt.getTime() > now)
      return { retryAfterMs: globalLimit.resetsAt.getTime() - now };
    const mailboxKeys = mailAddresses(participantMailRecipients(person)).map(
      (email) =>
        `smtp:mailbox:${createHash("sha256").update(email).digest("hex")}`,
    );
    for (const mailboxKey of mailboxKeys) {
      const [mailboxLimit] = await tx
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.key, mailboxKey));
      if (mailboxLimit && mailboxLimit.resetsAt.getTime() > now) {
        await tx
          .update(emailLogs)
          .set({ nextAttemptAt: mailboxLimit.resetsAt })
          .where(eq(emailLogs.id, match.mail.id));
        // Let other ready addresses advance instead of blocking the whole queue.
        return { retryAfterMs: 1 };
      }
    }
    await tx
      .update(rateLimits)
      .set({ resetsAt: new Date(now + 3000) })
      .where(eq(rateLimits.key, globalKey));
    for (const mailboxKey of mailboxKeys)
      await tx
        .insert(rateLimits)
        .values({
          key: mailboxKey,
          count: 0,
          resetsAt: new Date(now + 30000),
        })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: { resetsAt: new Date(now + 30000) },
        });
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(emailLogs)
      .set({
        status: "SENDING",
        leaseToken,
        leaseUntil: new Date(Date.now() + 120000),
        firstAttemptAt: match.mail.firstAttemptAt || new Date(),
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
    errors = 0,
    retryAfterMs = 0;
  let stopped = false;
  const started = Date.now();
  for (let i = 0; i < 5 && Date.now() - started < 20000; i++) {
    const mail = await claimNext(eventId);
    if (!mail) break;
    if ("retryAfterMs" in mail) {
      retryAfterMs = mail.retryAfterMs;
      break;
    }
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
      const receipt = await sendSmtp(payload, password, messageId);
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
        await tx.insert(auditLogs).values({
          eventId,
          adminId,
          action: receipt?.queueId
            ? `SMTP_EMAIL_ACCEPTED queue=${receipt.queueId}`
            : "SMTP_EMAIL_ACCEPTED",
          targetId: mail.id,
        });
      });
      sent++;
    } catch (error) {
      const retryDelay = smtpRetryDelay(error, mail.attempts);
      await db()
        .update(emailLogs)
        .set({
          status: retryDelay === null ? "ERROR" : "QUEUED",
          errorCode: smtpDiagnostic(error),
          ...(retryDelay === null
            ? {}
            : { nextAttemptAt: new Date(Date.now() + retryDelay) }),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(emailLogs.id, mail.id),
            eq(emailLogs.leaseToken, mail.leaseToken!),
          ),
        );
      if (retryDelay !== null) {
        retryAfterMs = retryDelay;
        break;
      }
      errors++;
      // A permanently rejected recipient should not prevent other invitations.
      if (!(
        error instanceof SmtpFailure &&
        error.stage === "RECIPIENT" &&
        error.smtpCode &&
        error.smtpCode >= 500 &&
        error.enhancedCode?.startsWith("5.1.")
      )) {
        stopped = true;
        break;
      }
    }
  }
  return { sent, errors, retryAfterMs, stopped };
}

export async function sendSmtpTest(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  return sendSingleSmtp(eventId, adminId, input, false);
}

export async function sendSelectedSmtp(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const value = z
    .object({ participantId: z.uuid(), requestId: z.uuid() })
    .strict()
    .parse(input);
  const [person] = await db()
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.id, value.participantId),
        eq(participants.eventId, eventId),
        realParticipant,
      ),
    );
  assert(person, 404, "Nie znaleziono uczestnika w tej konferencji.");
  return sendSingleSmtp(
    eventId,
    adminId,
    { ...value, email: person.email },
    true,
  );
}

async function sendSingleSmtp(
  eventId: string,
  adminId: string,
  input: unknown,
  selected: boolean,
) {
  const prefix = selected ? "SMTP_SELECTED" : "SMTP_TEST";
  const { email, requestId, participantId } = z
    .object({
      email: z.email().max(254),
      requestId: z.uuid(),
      participantId: z.uuid().optional(),
    })
    .parse(input);
  const { password, event } = await assertSmtpReady(eventId);
  const messageId = `<${selected ? "selected" : "test"}-${requestId}@oneday.com.pl>`;
  const person = participantId
    ? (
        await db()
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.id, participantId),
              eq(participants.eventId, eventId),
              ...(selected ? [realParticipant] : []),
            ),
          )
      )[0]
    : null;
  assert(
    !participantId || person,
    404,
    "Nie znaleziono uczestnika w tej konferencji.",
  );
  const personalized = person
    ? {
        ...(await invitation(person, event)),
        ...(!selected
          ? {
              to: email,
              cc: participantMailRecipients({
                email,
                secondaryEmail: person.secondaryEmail,
              }).cc,
            }
          : {}),
      }
    : null;
  const recipientLabel = personalized
    ? mailAddresses(personalized).join(", ")
    : email;
  // Persist the claim before SMTP. A repeated request never sends twice,
  // including when the first HTTP response is lost after SMTP acceptance.
  const claim = await claimSingleSmtp({
    requestId,
    eventId,
    adminId,
    targetId: participantId || eventId,
    action: `${prefix}_STARTED ${recipientLabel}`,
    to: personalized?.to || email,
    cc: personalized?.cc,
    content: personalized
      ? JSON.stringify([personalized.subject, personalized.html])
      : "generic-test-v1",
  });
  if (claim.state === "WAIT")
    return {
      messageId,
      status: "RATE_LIMITED",
      retryAfterMs: claim.retryAfterMs,
    };
  if (claim.state === "DUPLICATE")
    return { messageId, status: "DUPLICATE_BLOCKED" };
  if (claim.state === "REPLAY") {
    const [existing] = await db()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.id, requestId),
          eq(auditLogs.eventId, eventId),
          eq(auditLogs.adminId, adminId),
        ),
      );
    assert(existing, 409, "Identyfikator próby jest już użyty.");
    return {
      messageId,
      status: existing.action.startsWith(`${prefix}_ACCEPTED `)
        ? "ACCEPTED"
        : "REVIEW_REQUIRED",
      duplicate: true,
    };
  }
  try {
    await sendSmtp(
      personalized ?? {
        from: event.mailFrom,
        to: email,
        subject: "Test dostarczenia - Głowa do Góry",
        html:
          '<h1>Głowa do Góry</h1><p>To pojedyncza wiadomość testowa wysłana przez organizatora konferencji.</p><p>Potwierdza sprawdzenie nowego formatu wiadomości. Nie zawiera kodu uczestnika i nie wymaga odpowiedzi.</p><p><a href="' +
          new URL(process.env.APP_URL!).origin +
          '/uczestnik">Strefa uczestnika</a></p><p>Fundacja One Day</p>',
      },
      password,
      messageId,
    );
    await db()
      .update(auditLogs)
      .set({ action: `${prefix}_ACCEPTED ${recipientLabel}` })
      .where(eq(auditLogs.id, requestId));
    return { messageId, status: "ACCEPTED", duplicate: false };
  } catch (error) {
    const diagnostic = smtpDiagnostic(error);
    await db()
      .update(auditLogs)
      .set({ action: `${prefix}_REVIEW ${diagnostic} ${recipientLabel}` })
      .where(eq(auditLogs.id, requestId));
    return {
      messageId,
      status: "REVIEW_REQUIRED",
      diagnostic,
      duplicate: false,
    };
  }
}
