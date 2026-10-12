CREATE TABLE "survey_completions" (
  "participant_id" uuid PRIMARY KEY REFERENCES "participants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO "survey_completions" ("participant_id") SELECT "participant_id" FROM "survey_responses" ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "survey_responses" DROP COLUMN "participant_id", DROP COLUMN "submitted_at";
