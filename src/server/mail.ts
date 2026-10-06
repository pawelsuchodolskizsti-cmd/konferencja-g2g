import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  auditLogs,
  emailLogs,
  events,
  importBatches,
  participants,
  rateLimits,
  sessions,
  type MailPayload,
} from "@/db/schema";
import { encrypt, decrypt } from "./crypto";
import { assert } from "./errors";
import { generateCertificate } from "./certificates";
import { certificateAvailable, presentParticipant } from "./attendance";

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function renderTemplate(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => values[key] ?? `{{${key}}}`,
  );
}
function appUrl() {
  const value = process.env.APP_URL;
  assert(value, 503, "Brak adresu aplikacji.");
  return new URL(value).origin;
}
export async function invitation(
  person: typeof participants.$inferSelect,
  event: typeof events.$inferSelect,
): Promise<MailPayload> {
  const credentials = JSON.parse(decrypt(person.credentials)) as {
    accessCode: string;
    qrToken: string;
  };
  const values = {
    firstName: person.firstName,
    lastName: person.lastName,
    eventName: event.name,
    location: event.location,
    accessCode: credentials.accessCode,
    date: new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: event.timezone,
    }).format(event.startsAt),
  };
  const qr = await QRCode.toBuffer(
    `${appUrl()}/checkin/${credentials.qrToken}`,
    { width: 320, margin: 2, errorCorrectionLevel: "M" },
  );
  return {
    from: event.mailFrom,
    to: person.email,
    subject: renderTemplate(event.mailSubject, values),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#122c3a"><h1>${escapeHtml(event.name)}</h1><p style="white-space:pre-line">${escapeHtml(renderTemplate(event.mailBody, values)).replace(/\n/g, "<br>")}</p><p>Pokaż ten kod przy wejściu:</p><img src="cid:participant-qr" alt="Kod QR do rejestracji obecności" width="240" height="240"><p>Twój kod dostępu: <strong>${credentials.accessCode}</strong></p><p><a href="${appUrl()}/uczestnik">Strefa uczestnika</a></p><p>Zachowaj wiadomość. Materiały i szkolenia będą dostępne po potwierdzeniu obecności, a certyfikat po zakończeniu konferencji.</p></div>`,
    attachments: [
      {
        filename: "qr.png",
        content: qr.toString("base64"),
        content_id: "participant-qr",
      },
    ],
  };
}
export async function queueInvitations(
  eventId: string,
  adminId: string,
  database: Database = db(),
) {
  return database.transaction(async (tx) => {
    const people = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.eventId, eventId));
    if (!people.length) return { queued: 0 };
    const inserted = await tx
      .insert(emailLogs)
      .values(
        people.map((p) => ({
          participantId: p.id,
          kind: "INVITATION" as const,
          adminId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: emailLogs.id });
    const retries = await tx
      .update(emailLogs)
      .set({
        status: "QUEUED",
        nextAttemptAt: new Date(),
        attempts: 0,
        adminId,
      })
      .where(
        and(
          inArray(
            emailLogs.participantId,
            people.map((p) => p.id),
          ),
          eq(emailLogs.kind, "INVITATION"),
          eq(emailLogs.status, "ERROR"),
          sql`(${emailLogs.firstAttemptAt} IS NULL OR ${emailLogs.firstAttemptAt} > NOW() - INTERVAL '23 hours')`,
          sql`${emailLogs.errorCode} IS DISTINCT FROM 'REVIEW_REQUIRED'`,
        ),
      )
      .returning({ id: emailLogs.id });
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "EMAIL_CAMPAIGN_STARTED",
        targetId: eventId,
      });
    return { queued: inserted.length + retries.length };
  });
}
export async function queueCertificate(participantId: string) {
  const { event } = await presentParticipant(participantId);
  assert(
    certificateAvailable(event),
    403,
    "Certyfikat nie jest jeszcze dostępny.",
  );
  const [existing] = await db()
    .select()
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.participantId, participantId),
        eq(emailLogs.kind, "CERTIFICATE"),
      ),
    );
  if (existing) {
    if (
      existing.status === "ERROR" &&
      existing.errorCode !== "REVIEW_REQUIRED" &&
      (!existing.firstAttemptAt ||
        Date.now() - existing.firstAttemptAt.getTime() < 23 * 3600000)
    ) {
      await db()
        .update(emailLogs)
        .set({ status: "QUEUED", attempts: 0, nextAttemptAt: new Date() })
        .where(
          and(eq(emailLogs.id, existing.id), eq(emailLogs.status, "ERROR")),
        );
      return { status: "QUEUED" };
    }
    return { status: existing.status };
  }
  await db()
    .insert(emailLogs)
    .values({ participantId, kind: "CERTIFICATE" })
    .onConflictDoNothing();
  return { status: "QUEUED" };
}
export async function claimMail(database: Database = db()) {
  return database.transaction(async (tx) => {
    const now = new Date();
    const [job] = await tx
      .select()
      .from(emailLogs)
      .where(
        and(
          lt(emailLogs.nextAttemptAt, now),
          or(
            eq(emailLogs.status, "QUEUED"),
            and(eq(emailLogs.status, "SENDING"), lt(emailLogs.leaseUntil, now)),
          ),
        ),
      )
      .orderBy(emailLogs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    if (
      job.firstAttemptAt &&
      now.getTime() - job.firstAttemptAt.getTime() > 23 * 3600000
    ) {
      await tx
        .update(emailLogs)
        .set({
          status: "ERROR",
          errorCode: "REVIEW_REQUIRED",
          leaseUntil: null,
          leaseToken: null,
        })
        .where(eq(emailLogs.id, job.id));
      return null;
    }
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(emailLogs)
      .set({
        status: "SENDING",
        attempts: job.attempts + 1,
        leaseToken,
        leaseUntil: new Date(Date.now() + 180000),
      })
      .where(eq(emailLogs.id, job.id))
      .returning();
    return claimed;
  });
}
export function retryDecision(attempts: number, status?: number) {
  const permanent =
    !!status &&
    status >= 400 &&
    status < 500 &&
    status !== 429 &&
    status !== 409;
  return {
    retry: !permanent && attempts < 5,
    delay: Math.min(3600, 2 ** attempts * 30),
  };
}
export async function processMail() {
  assert(
    process.env.APP_ENV === "production" &&
      (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production") &&
      process.env.MAIL_ENABLED === "true" &&
      process.env.RESEND_API_KEY,
    503,
    "Wysyłka jest wyłączona lub brakuje konfiguracji.",
  );
  const start = Date.now();
  let sent = 0;
  let errors = 0;
  for (let i = 0; i < 12 && Date.now() - start < 45000; i++) {
    const job = await claimMail();
    if (!job) break;
    let providerStatus: number | undefined;
    try {
      const [context] = await db()
        .select({ person: participants, event: events })
        .from(participants)
        .innerJoin(events, eq(events.id, participants.eventId))
        .where(eq(participants.id, job.participantId));
      assert(context, 404, "Brak uczestnika.");
      let payload: MailPayload;
      if (job.kind === "CERTIFICATE") {
        const { event } = await presentParticipant(job.participantId);
        assert(
          certificateAvailable(event),
          403,
          "Certyfikat nie jest dostępny.",
        );
      }
      if (job.payloadEncrypted)
        payload = JSON.parse(decrypt(job.payloadEncrypted));
      else {
        if (job.kind === "INVITATION")
          payload = await invitation(context.person, context.event);
        else {
          const { pdf } = await generateCertificate(job.participantId);
          payload = {
            from: context.event.mailFrom,
            to: context.person.email,
            subject: `Certyfikat: ${context.event.name}`,
            html: "<p>Dziękujemy za udział. Twój certyfikat znajduje się w załączniku.</p>",
            attachments: [
              { filename: "certyfikat.pdf", content: pdf.toString("base64") },
            ],
          };
        }
        await db()
          .update(emailLogs)
          .set({ payloadEncrypted: encrypt(JSON.stringify(payload)) })
          .where(
            and(
              eq(emailLogs.id, job.id),
              eq(emailLogs.leaseToken, job.leaseToken!),
            ),
          );
      }
      await db()
        .update(emailLogs)
        .set({ firstAttemptAt: job.firstAttemptAt || new Date() })
        .where(
          and(
            eq(emailLogs.id, job.id),
            eq(emailLogs.leaseToken, job.leaseToken!),
          ),
        );
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `conference-${job.id}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      providerStatus = response.status;
      assert(response.ok, 502, "Błąd wysyłki.");
      const data = (await response.json()) as { id?: string };
      assert(data.id, 502, "Brak potwierdzenia wysyłki.");
      await db().transaction(async (tx) => {
        await tx
          .update(emailLogs)
          .set({
            status: "SENT",
            sentAt: new Date(),
            providerId: data.id,
            payloadEncrypted: null,
            errorCode: null,
            leaseUntil: null,
            leaseToken: null,
          })
          .where(
            and(
              eq(emailLogs.id, job.id),
              eq(emailLogs.leaseToken, job.leaseToken!),
            ),
          );
        await tx
          .insert(auditLogs)
          .values({
            eventId: context.event.id,
            adminId: job.adminId,
            action: "EMAIL_SENT",
            targetId: job.id,
          });
      });
      sent++;
    } catch {
      const retry = retryDecision(job.attempts, providerStatus);
      await db()
        .update(emailLogs)
        .set({
          status: retry.retry ? "QUEUED" : "ERROR",
          errorCode: providerStatus
            ? `PROVIDER_${providerStatus}`
            : "SEND_FAILED",
          nextAttemptAt: new Date(Date.now() + retry.delay * 1000),
          leaseUntil: null,
          leaseToken: null,
        })
        .where(
          and(
            eq(emailLogs.id, job.id),
            eq(emailLogs.leaseToken, job.leaseToken!),
          ),
        );
      errors++;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { sent, errors };
}
export async function cleanupEphemeral() {
  const now = new Date();
  await db().delete(sessions).where(lt(sessions.expiresAt, now));
  await db().delete(rateLimits).where(lt(rateLimits.resetsAt, now));
  await db().delete(importBatches).where(lt(importBatches.expiresAt, now));
}
