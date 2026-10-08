ALTER TABLE "events" DROP CONSTRAINT "event_dates";
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "event_dates" CHECK ("events"."ends_at" > "events"."starts_at" AND "events"."certificate_unlock_at" >= "events"."starts_at");