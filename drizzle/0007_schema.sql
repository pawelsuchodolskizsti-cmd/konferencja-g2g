CREATE TABLE "data_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"admin_id" uuid,
	"reason" text NOT NULL,
	"participant_count" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"files" jsonb NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "data_archives" ADD CONSTRAINT "data_archives_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_archives" ADD CONSTRAINT "data_archives_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "data_archives_event" ON "data_archives" USING btree ("event_id");