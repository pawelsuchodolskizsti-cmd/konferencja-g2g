import "server-only";
import { and, eq, asc, sql, like } from "drizzle-orm";
import { db, type Database } from "@/db";
import { participants, attendance, auditLogs } from "@/db/schema";
import {
  PARTICIPANT_PRIVACY_ACTION,
  PARTICIPANT_PRIVACY_VERSION,
} from "@/lib/participant-privacy";
import { safeCsv } from "./imports";
export async function privacyRecords(
  eventId: string,
  database: Database = db(),
) {
  const records = database
    .select({
      participantId: auditLogs.targetId,
      firstAt: sql<string | null>`min(${auditLogs.createdAt})::text`.as(
        "first_at",
      ),
      lastAt: sql<string | null>`max(${auditLogs.createdAt})::text`.as(
        "last_at",
      ),
      total: sql<number>`count(*)::int`.as("total"),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventId, eventId),
        eq(auditLogs.action, PARTICIPANT_PRIVACY_ACTION),
      ),
    )
    .groupBy(auditLogs.targetId)
    .as("privacy_records");
  const people = await database
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      email: participants.email,
      checkedInAt: attendance.checkedInAt,
      firstAcknowledgedAt: records.firstAt,
      lastAcknowledgedAt: records.lastAt,
      count: sql<number>`coalesce(${records.total},0)::int`,
    })
    .from(participants)
    .leftJoin(attendance, eq(attendance.participantId, participants.id))
    .leftJoin(records, eq(records.participantId, participants.id))
    .where(eq(participants.eventId, eventId))
    .orderBy(participants.lastName, participants.firstName);
  return { version: PARTICIPANT_PRIVACY_VERSION, people };
}
export async function exportPrivacyRecords(
  eventId: string,
  database: Database = db(),
) {
  const rows = await database
    .select({
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
      firstName: participants.firstName,
      lastName: participants.lastName,
      email: participants.email,
    })
    .from(auditLogs)
    .innerJoin(
      participants,
      and(
        eq(participants.id, auditLogs.targetId),
        eq(participants.eventId, eventId),
      ),
    )
    .where(
      and(
        eq(auditLogs.eventId, eventId),
        like(auditLogs.action, "PARTICIPANT_PRIVACY_ACK_%"),
      ),
    )
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
  const csv = [
    [
      "Imię",
      "Nazwisko",
      "E-mail",
      "Wersja klauzuli",
      "Data potwierdzenia (UTC)",
    ],
    ...rows.map((r) => [
      r.firstName,
      r.lastName,
      r.email,
      r.action.slice("PARTICIPANT_PRIVACY_ACK_".length),
      r.createdAt.toISOString(),
    ]),
  ]
    .map((row) => row.map(safeCsv).join(";"))
    .join("\r\n");
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="potwierdzenia-klauzuli.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
