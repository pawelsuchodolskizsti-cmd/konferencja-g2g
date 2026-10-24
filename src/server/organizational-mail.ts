import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  events,
  organizationalCampaigns,
  organizationalDeliveries,
  participants,
  rateLimits,
  smtpSettings,
} from "@/db/schema";
import { realParticipant } from "./participant-scope";
import { encrypt, decrypt } from "./crypto";
import { participantMailRecipients, mailAddresses } from "@/lib/mail-recipients";
import { organizationalDefaultBody, organizationalDefaultSubject, renderOrganizationalBody, renderOrganizationalSubject, type OrganizationalTemplateValues } from "@/lib/organizational-mail";
import { sendSmtp } from "./smtp-transport";
import { smtpDiagnostic, smtpRetryDelay, SmtpFailure } from "./smtp-message";
import { assert, AppError } from "./errors";

type Recipients = { to: string; cc?: string };
type DeliveryStatus = "QUEUED" | "SENDING" | "ACCEPTED" | "FAILED" | "REVIEW_REQUIRED";
const GLOBAL_SMTP_KEY = "smtp:dispatch:konferencja@oneday.com.pl";
const SENDER = "konferencja@oneday.com.pl";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const draftSchema = z.object({
  subject: z.string().trim().min(3).max(200).refine((value) => !/[\r\n]/.test(value), "Temat musi być w jednej linii."),
  body: z.string().trim().min(10).max(10000),
}).strict();

export function definiteSmtpFailure(error: unknown) {
  if (!(error instanceof SmtpFailure)) return false;
  if (error.smtpCode && error.smtpCode >= 400 && error.smtpCode <= 599)
    return true; // An explicit SMTP rejection means DATA was not accepted.
  return ["CONNECT", "GREETING", "EHLO", "AUTH", "FROM", "RECIPIENT", "DATA"].includes(error.stage);
}

export function organizationalStatusLabel(status: DeliveryStatus) {
  return ({
    QUEUED: "W kolejce",
    SENDING: "Trwa wysyłanie",
    ACCEPTED: "Przyjęta przez home.pl",
    FAILED: "Odrzucona / bezpieczna do ponowienia",
    REVIEW_REQUIRED: "Niepewny wynik — sprawdź w home.pl",
  })[status];
}

async function config(eventId: string) {
  const secure = process.env.APP_ENV === "production" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production") &&
    process.env.APP_URL?.startsWith("https://");
  assert(secure, 503, "Wysyłka działa wyłącznie w produkcji z poprawną domeną HTTPS.");
  const [[account], [event]] = await Promise.all([
    db().select().from(smtpSettings).where(eq(smtpSettings.eventId, eventId)),
    db().select().from(events).where(eq(events.id, eventId)),
  ]);
  assert(event, 404, "Nie znaleziono konferencji.");
  assert(account, 503, "Najpierw skonfiguruj SMTP w zakładce Wysyłka.");
  assert(event.mailFrom.toLowerCase() === SENDER, 409, "Nieprawidłowy adres nadawcy.");
  return { password: decrypt(account.passwordEncrypted), event };
}

async function campaign(eventId: string, campaignId: string) {
  const [record] = await db().select().from(organizationalCampaigns)
    .where(and(eq(organizationalCampaigns.id, campaignId), eq(organizationalCampaigns.eventId, eventId)));
  assert(record, 404, "Nie znaleziono kampanii.");
  return record;
}

export async function listOrganizational(eventId: string) {
  const [people, campaigns] = await Promise.all([
    db().select({
      id: participants.id, firstName: participants.firstName, lastName: participants.lastName,
      email: participants.email, secondaryEmail: participants.secondaryEmail,
    }).from(participants).where(and(eq(participants.eventId, eventId), realParticipant))
      .orderBy(participants.lastName, participants.firstName),
    db().select().from(organizationalCampaigns)
      .where(eq(organizationalCampaigns.eventId, eventId))
      .orderBy(desc(organizationalCampaigns.createdAt)),
  ]);
  const deliveryStats = campaigns.length
    ? await db().select({
      campaignId: organizationalDeliveries.campaignId,
      status: organizationalDeliveries.status,
    }).from(organizationalDeliveries)
      .where(inArray(organizationalDeliveries.campaignId, campaigns.map((c) => c.id)))
    : [];
  return {
    people,
    campaigns: campaigns.map((c) => ({
      id: c.id, subject: c.subject, createdAt: c.createdAt,
      launchedAt: c.launchedAt, updatedAt: c.updatedAt,
      stats: deliveryStats.filter((d) => d.campaignId === c.id).reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    })),
  };
}

export async function createOrganizational(eventId: string, adminId: string) {
  const [created] = await db().insert(organizationalCampaigns).values({
    eventId, adminId, subject: organizationalDefaultSubject, body: organizationalDefaultBody,
  }).returning({ id: organizationalCampaigns.id });
  await db().insert(auditLogs).values({ eventId, adminId, action: "ORGANIZATIONAL_DRAFT_CREATED", targetId: created.id });
  return created;
}

export async function getOrganizational(eventId: string, campaignId: string) {
  const c = await campaign(eventId, campaignId);
  const rows = await db().select({
    id: organizationalDeliveries.id,
    participantId: organizationalDeliveries.participantId,
    firstName: participants.firstName,
    lastName: participants.lastName,
    recipientsEncrypted: organizationalDeliveries.recipientsEncrypted,
    status: organizationalDeliveries.status,
    attempts: organizationalDeliveries.attempts,
    firstAttemptAt: organizationalDeliveries.firstAttemptAt,
    lastAttemptAt: organizationalDeliveries.lastAttemptAt,
    acceptedAt: organizationalDeliveries.acceptedAt,
    errorCode: organizationalDeliveries.errorCode,
    messageId: organizationalDeliveries.messageId,
    smtpQueueId: organizationalDeliveries.smtpQueueId,
    nextAttemptAt: organizationalDeliveries.nextAttemptAt,
  }).from(organizationalDeliveries)
    .innerJoin(participants, eq(organizationalDeliveries.participantId, participants.id))
    .where(eq(organizationalDeliveries.campaignId, c.id))
    .orderBy(participants.lastName, participants.firstName);
  return {
    id: c.id, subject: c.subject, body: c.body,
    createdAt: c.createdAt, launchedAt: c.launchedAt,
    deliveries: rows.map(({ recipientsEncrypted, ...row }) => ({
      ...row, recipients: JSON.parse(decrypt(recipientsEncrypted)) as Recipients,
    })),
  };
}

export async function saveOrganizationalDraft(eventId: string, campaignId: string, adminId: string, input: unknown) {
  const data = draftSchema.parse(input);
  const [saved] = await db().update(organizationalCampaigns)
    .set({ ...data, updatedAt: new Date() })
    .where(and(
      eq(organizationalCampaigns.eventId, eventId),
      eq(organizationalCampaigns.id, campaignId),
      isNull(organizationalCampaigns.launchedAt),
    )).returning({ id: organizationalCampaigns.id });
  assert(saved, 409, "Nie można edytować kampanii po uruchomieniu.");
  await db().insert(auditLogs).values({ eventId, adminId, action: "ORGANIZATIONAL_DRAFT_SAVED", targetId: campaignId });
  return { saved: true };
}

export async function launchOrganizational(eventId: string, campaignId: string, adminId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(2000) }).strict().parse(input);
  const distinct = [...new Set(ids)];
  assert(distinct.length === ids.length, 400, "Lista uczestników zawiera duplikaty.");
  return db().transaction(async (tx) => {
    const [c] = await tx.select().from(organizationalCampaigns)
      .where(and(eq(organizationalCampaigns.id, campaignId), eq(organizationalCampaigns.eventId, eventId)))
      .for("update");
    assert(c, 404, "Brak kampanii.");
    assert(!c.launchedAt, 409, "Kampania została już uruchomiona; nie wyślemy jej ponownie.");
    const recent = await tx.select({ id: organizationalCampaigns.id }).from(organizationalCampaigns)
      .where(and(
        eq(organizationalCampaigns.eventId, eventId),
        eq(organizationalCampaigns.subject, c.subject),
        eq(organizationalCampaigns.body, c.body),
        sql`${organizationalCampaigns.launchedAt} > now() - interval '10 minutes'`,
      )).limit(1);
    assert(!recent.length, 409, "Podobna kampania została uruchomiona w ostatnich 10 minutach. Zweryfikuj historię.");
    const people = await tx.select().from(participants)
      .where(and(eq(participants.eventId, eventId), inArray(participants.id, distinct), realParticipant));
    assert(people.length === ids.length, 409, "Lista uczestników zmieniła się. Odśwież i zaznacz ponownie.");
    await tx.insert(organizationalDeliveries).values(people.map((p) => {
      const deliveryId = randomUUID();
      return {
        id: deliveryId,
        campaignId,
        participantId: p.id,
        recipientsEncrypted: encrypt(JSON.stringify(participantMailRecipients(p))),
        messageId: `<organizational-${deliveryId}@oneday.com.pl>`,
      };
    }));
    await tx.update(organizationalCampaigns).set({ launchedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizationalCampaigns.id, campaignId));
    await tx.insert(auditLogs).values({
      eventId, adminId, action: `ORGANIZATIONAL_LAUNCHED_${ids.length}`, targetId: campaignId,
    });
    return { queued: ids.length };
  });
}

type Claim = { type: "claimed"; row: typeof organizationalDeliveries.$inferSelect; recipients: Recipients }
  | { type: "waiting"; retryAfterMs: number }
  | { type: "empty" };

async function claimNext(eventId: string, campaignId: string): Promise<Claim> {
  return db().transaction(async (tx) => {
    const [c] = await tx.select({ id: organizationalCampaigns.id, launchedAt: organizationalCampaigns.launchedAt })
      .from(organizationalCampaigns).where(and(
        eq(organizationalCampaigns.id, campaignId), eq(organizationalCampaigns.eventId, eventId),
      ));
    assert(c?.launchedAt, 409, "Najpierw wybierz odbiorców i uruchom kampanię.");
    const now = new Date();
    const [row] = await tx.select().from(organizationalDeliveries)
      .where(and(eq(organizationalDeliveries.campaignId, campaignId),
        eq(organizationalDeliveries.status, "QUEUED"),
        lte(organizationalDeliveries.nextAttemptAt, now)))
      .orderBy(asc(organizationalDeliveries.nextAttemptAt), asc(organizationalDeliveries.createdAt))
      .limit(1).for("update", { skipLocked: true });
    if (!row) {
      const [next] = await tx.select({ at: organizationalDeliveries.nextAttemptAt })
        .from(organizationalDeliveries)
        .where(and(eq(organizationalDeliveries.campaignId, campaignId),
          eq(organizationalDeliveries.status, "QUEUED")))
        .orderBy(asc(organizationalDeliveries.nextAttemptAt)).limit(1);
      return next
        ? { type: "waiting" as const, retryAfterMs: Math.max(1000, next.at.getTime() - Date.now()) }
        : { type: "empty" as const };
    }
    const recipients = JSON.parse(decrypt(row.recipientsEncrypted)) as Recipients;
    const [global] = await tx.insert(rateLimits).values({
      key: GLOBAL_SMTP_KEY, count: 0, resetsAt: new Date(0),
    }).onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count}` } })
      .returning({ resetsAt: rateLimits.resetsAt });
    let wait = Math.max(0, global.resetsAt.getTime() - Date.now());
    for (const email of mailAddresses(recipients)) {
      const [limit] = await tx.select({ resetsAt: rateLimits.resetsAt }).from(rateLimits)
        .where(eq(rateLimits.key, `smtp:mailbox:${digest(email)}`));
      if (limit) wait = Math.max(wait, limit.resetsAt.getTime() - Date.now());
    }
    if (wait > 0) {
      if (global.resetsAt.getTime() <= Date.now()) {
        await tx.update(organizationalDeliveries).set({ nextAttemptAt: new Date(Date.now() + wait) })
          .where(eq(organizationalDeliveries.id, row.id));
        return { type: "waiting" as const, retryAfterMs: 1000 };
      }
      return { type: "waiting" as const, retryAfterMs: wait };
    }
    const leaseToken = randomUUID();
    const stamp = new Date();
    await tx.update(rateLimits).set({ resetsAt: new Date(stamp.getTime() + 3000) })
      .where(eq(rateLimits.key, GLOBAL_SMTP_KEY));
    for (const email of mailAddresses(recipients)) {
      const key = `smtp:mailbox:${digest(email)}`;
      await tx.insert(rateLimits).values({ key, count: 0, resetsAt: new Date(stamp.getTime() + 30000) })
        .onConflictDoUpdate({ target: rateLimits.key, set: { resetsAt: new Date(stamp.getTime() + 30000) } });
    }
    const [claimed] = await tx.update(organizationalDeliveries).set({
      status: "SENDING",
      attempts: row.attempts + 1,
      firstAttemptAt: row.firstAttemptAt ?? stamp,
      lastAttemptAt: stamp,
      leaseToken, leaseUntil: new Date(stamp.getTime() + 120000),
    }).where(eq(organizationalDeliveries.id, row.id)).returning();
    return { type: "claimed" as const, row: claimed, recipients };
  });
}

export async function retryOrganizational(eventId: string, campaignId: string, deliveryId: string, adminId: string) {
  await campaign(eventId, campaignId);
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(organizationalDeliveries)
      .where(and(eq(organizationalDeliveries.id, deliveryId),
        eq(organizationalDeliveries.campaignId, campaignId))).for("update");
    assert(row, 404, "Nie znaleziono wiadomości.");
    assert(row.status === "FAILED" && row.errorCode?.startsWith("SMTP_"), 409,
      "Ponowienie jest dostępne tylko po jednoznacznym nieprzyjęciu przez SMTP. Sprawdź historię.");
    await tx.update(organizationalDeliveries).set({
      status: "QUEUED", nextAttemptAt: new Date(),
      messageId: `<organizational-${randomUUID()}@oneday.com.pl>`,
      errorCode: null, leaseUntil: null, leaseToken: null,
    }).where(eq(organizationalDeliveries.id, deliveryId));
    await tx.insert(auditLogs).values({
      eventId, adminId, action: "ORGANIZATIONAL_MANUAL_RETRY", targetId: deliveryId,
    });
    return { queued: true };
  });
}

function variables(person: typeof participants.$inferSelect, event: typeof events.$inferSelect): OrganizationalTemplateValues {
  const code = (JSON.parse(decrypt(person.credentials)) as { accessCode: string }).accessCode;
  return {
    firstName: person.firstName, lastName: person.lastName, accessCode: code,
    eventName: event.name, location: event.location,
    date: new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: event.timezone }).format(event.startsAt),
    panelUrl: new URL("/uczestnik", process.env.APP_URL!).toString(),
  };
}

export async function processOrganizational(eventId: string, campaignId: string, adminId: string) {
  const { password, event } = await config(eventId);
  const c = await campaign(eventId, campaignId);
  assert(c.launchedAt, 409, "Najpierw zatwierdź listę odbiorców.");
  const now = new Date();
  // Stale lease may conceal SMTP acceptance. Never automatically resend it.
  await db().update(organizationalDeliveries).set({
    status: "REVIEW_REQUIRED", errorCode: "REVIEW_REQUIRED_TIMEOUT",
    leaseToken: null, leaseUntil: null,
  }).where(and(eq(organizationalDeliveries.campaignId, campaignId),
    eq(organizationalDeliveries.status, "SENDING"), lte(organizationalDeliveries.leaseUntil, now)));
  let sent = 0, errors = 0, retryAfterMs = 0, stopped = false;
  const started = Date.now();
  for (let i = 0; i < 5 && Date.now() - started < 20000; i++) {
    const claim = await claimNext(eventId, campaignId);
    if (claim.type === "empty") break;
    if (claim.type === "waiting") {
      retryAfterMs = claim.retryAfterMs;
      break;
    }
    const { row, recipients } = claim;
    try {
      const [person] = await db().select().from(participants).where(and(
        eq(participants.id, row.participantId), eq(participants.eventId, eventId), realParticipant,
      ));
      assert(person, 404, "Nie znaleziono uczestnika.");
      const current = participantMailRecipients(person);
      assert(JSON.stringify(recipients) === JSON.stringify(current), 409,
        "Adres uczestnika zmienił się po zatwierdzeniu kampanii.");
      const values = variables(person, event);
      const receipt = await sendSmtp({
        from: SENDER, ...recipients,
        subject: renderOrganizationalSubject(c.subject, values),
        html: '<!doctype html><html lang="pl"><head><meta charset="utf-8"></head><body><div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#122c3a;line-height:1.6">' +
          renderOrganizationalBody(c.body, values) + '</div></body></html>',
      }, password, row.messageId);
      await db().transaction(async (tx) => {
        const [updated] = await tx.update(organizationalDeliveries).set({
          status: "ACCEPTED", acceptedAt: new Date(), errorCode: null,
          smtpQueueId: receipt.queueId, leaseToken: null, leaseUntil: null,
        }).where(and(eq(organizationalDeliveries.id, row.id),
          eq(organizationalDeliveries.leaseToken, row.leaseToken!))).returning({ id: organizationalDeliveries.id });
        assert(updated, 409, "Niepewny status po przyjęciu SMTP — wymagana weryfikacja.");
        await tx.insert(auditLogs).values({
          eventId, adminId, action: "ORGANIZATIONAL_SMTP_ACCEPTED", targetId: row.id,
        });
      });
      sent++;
    } catch (error) {
      const definite = definiteSmtpFailure(error);
      const retryMs = definite ? smtpRetryDelay(error, row.attempts) : null;
      const status: DeliveryStatus = !definite ? "REVIEW_REQUIRED" :
        retryMs === null ? "FAILED" : "QUEUED";
      await db().transaction(async (tx) => {
        await tx.update(organizationalDeliveries).set({
          status, errorCode: error instanceof SmtpFailure ? smtpDiagnostic(error) :
            error instanceof AppError && error.status === 409 ? "RECIPIENT_CHANGED" : "REVIEW_REQUIRED",
          nextAttemptAt: retryMs === null ? row.nextAttemptAt : new Date(Date.now() + retryMs),
          leaseToken: null, leaseUntil: null,
        }).where(and(eq(organizationalDeliveries.id, row.id),
          eq(organizationalDeliveries.leaseToken, row.leaseToken!)));
        await tx.insert(auditLogs).values({
          eventId, adminId, action: `ORGANIZATIONAL_${status}`, targetId: row.id,
        });
      });
      if (status === "QUEUED") {
        retryAfterMs = Math.min(retryMs!, 30000);
      } else {
        errors++;
        if (status === "REVIEW_REQUIRED" ||
          !(error instanceof SmtpFailure && error.stage === "RECIPIENT" && error.smtpCode &&
            error.smtpCode >= 500 && error.enhancedCode?.startsWith("5.1."))) stopped = true;
      }
      if (stopped || retryAfterMs) break;
    }
  }
  return { sent, errors, retryAfterMs, stopped };
}
