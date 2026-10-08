import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").defaultRandom().primaryKey();
const created = (name = "created_at") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();
export type AgendaItem = {
  block?: string;
  description?: string;
  guest?: string;
  title: string;
  speaker: string;
  start: string;
  end: string;
};
export const events = pgTable(
  "events",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    organizer: text("organizer").notNull(),
    location: text("location").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    certificateUnlockAt: timestamp("certificate_unlock_at", {
      withTimezone: true,
    }).notNull(),
    timezone: text("timezone").notNull().default("Europe/Warsaw"),
    published: boolean("published").notNull().default(false),
    agenda: jsonb("agenda").$type<AgendaItem[]>().notNull().default([]),
    info: text("info").notNull().default(""),
    mailSubject: text("mail_subject")
      .notNull()
      .default("Zaproszenie: {{eventName}}"),
    mailBody: text("mail_body")
      .notNull()
      .default(
        "Cześć {{firstName}},\nZapraszamy na {{eventName}}.\nData: {{date}}\nMiejsce: {{location}}\nTwój kod: {{accessCode}}",
      ),
    mailFrom: text("mail_from").notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    check(
      "event_dates",
      sql`${t.endsAt} > ${t.startsAt} AND ${t.certificateUnlockAt} >= ${t.startsAt}`,
    ),
  ],
);
export const admins = pgTable("admins", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
});
export const adminEvents = pgTable(
  "admin_events",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("admin_event_unique").on(t.adminId, t.eventId)],
);
export const participants = pgTable(
  "participants",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    accessHash: text("access_hash").notNull().unique(),
    qrHash: text("qr_hash").notNull().unique(),
    credentials: text("credentials").notNull(),
    createdAt: created(),
    updatedAt: created("updated_at"),
  },
  (t) => [
    uniqueIndex("participant_email_event").on(t.eventId, t.email),
    index("participant_event").on(t.eventId),
  ],
);
export const attendance = pgTable(
  "attendance",
  {
    id: id(),
    participantId: uuid("participant_id")
      .notNull()
      .unique()
      .references(() => participants.id, { onDelete: "cascade" }),
    checkedInAt: created("checked_in_at"),
    method: text("method", { enum: ["QR", "MANUAL"] }).notNull(),
    adminId: uuid("admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
  },
  (t) => [check("checkin_method", sql`${t.method} IN ('QR','MANUAL')`)],
);
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    adminId: uuid("admin_id").references(() => admins.id, {
      onDelete: "cascade",
    }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [
    check(
      "one_session_subject",
      sql`(${t.adminId} IS NULL) <> (${t.participantId} IS NULL)`,
    ),
  ],
);
export type ImportRow = {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  errors: string[];
};
export const importBatches = pgTable("import_batches", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => admins.id),
  rows: jsonb("rows").$type<ImportRow[]>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  createdAt: created(),
});
export type MailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string; content_id?: string }[];
};
export const emailLogs = pgTable(
  "email_logs",
  {
    id: id(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["INVITATION", "CERTIFICATE"] }).notNull(),
    status: text("status", { enum: ["QUEUED", "SENDING", "SENT", "ERROR"] })
      .notNull()
      .default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: created("next_attempt_at"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    payloadEncrypted: text("payload_encrypted"),
    providerId: text("provider_id"),
    errorCode: text("error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    adminId: uuid("admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("one_email_per_kind").on(t.participantId, t.kind),
    index("mail_queue").on(t.status, t.nextAttemptAt),
  ],
);
export const trainingCourses = pgTable("training_courses", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
  mode: text("mode", { enum: ["SHARED", "INDIVIDUAL"] }).notNull(),
  sharedCode: text("shared_code"),
});
export const trainingCodes = pgTable("training_codes", {
  id: id(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => trainingCourses.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  encryptedCode: text("encrypted_code").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});
export const participantTrainingAccess = pgTable(
  "participant_training_access",
  {
    id: id(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "cascade" }),
    codeId: uuid("code_id")
      .notNull()
      .unique()
      .references(() => trainingCodes.id),
    createdAt: created(),
  },
  (t) => [uniqueIndex("one_course_per_person").on(t.participantId, t.courseId)],
);
export const certificates = pgTable("certificates", {
  id: id(),
  participantId: uuid("participant_id")
    .notNull()
    .unique()
    .references(() => participants.id, { onDelete: "cascade" }),
  number: text("number").notNull().unique(),
  createdAt: created(),
});
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  eventId: uuid("event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  adminId: uuid("admin_id").references(() => admins.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  createdAt: created(),
});
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
});
export const materials = pgTable("materials", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  encryptedContent: text("encrypted_content").notNull(),
  createdAt: created(),
});
export const surveys = pgTable("surveys", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  questions: jsonb("questions").$type<string[]>().notNull(),
  published: boolean("published").notNull().default(false),
  updatedAt: created("updated_at"),
});
export const surveyResponses = pgTable("survey_responses", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id")
    .notNull()
    .unique()
    .references(() => participants.id, { onDelete: "cascade" }),
  questions: jsonb("questions").$type<string[]>().notNull(),
  answersEncrypted: text("answers_encrypted").notNull(),
  submittedAt: created("submitted_at"),
});

