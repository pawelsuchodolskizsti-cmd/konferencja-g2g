DROP INDEX IF EXISTS "participant_email_event";
--> statement-breakpoint
CREATE TABLE "smtp_settings" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "password_encrypted" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;