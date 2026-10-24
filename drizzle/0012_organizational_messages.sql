CREATE TABLE "organizational_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "admin_id" uuid REFERENCES "admins"("id") ON DELETE set null,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "launched_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organizational_campaigns_event" ON "organizational_campaigns" ("event_id","created_at");
--> statement-breakpoint
CREATE TABLE "organizational_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "organizational_campaigns"("id") ON DELETE cascade,
  "participant_id" uuid NOT NULL REFERENCES "participants"("id") ON DELETE cascade,
  "recipients_encrypted" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "first_attempt_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "lease_token" uuid,
  "lease_until" timestamp with time zone,
  "message_id" text NOT NULL,
  "smtp_queue_id" text,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizational_delivery_status" CHECK ("status" IN ('QUEUED','SENDING','ACCEPTED','FAILED','REVIEW_REQUIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organizational_delivery_once" ON "organizational_deliveries" ("campaign_id","participant_id");
--> statement-breakpoint
CREATE INDEX "organizational_delivery_queue" ON "organizational_deliveries" ("campaign_id","status","next_attempt_at");
