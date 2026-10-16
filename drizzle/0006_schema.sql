CREATE TABLE "invitation_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"title" text DEFAULT 'ZAPROSZENIE' NOT NULL,
	"message" text DEFAULT 'Zapraszamy do udziału w konferencji.' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);

--> statement-breakpoint
ALTER TABLE "admin_events" ADD COLUMN "role" text DEFAULT 'ADMIN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "published" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitation_settings" ADD CONSTRAINT "invitation_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;