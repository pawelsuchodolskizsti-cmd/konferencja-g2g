import { sql } from "drizzle-orm";
import { participants } from "@/db/schema";

// Persisted by participant ID, so editing an email does not re-enable campaigns.
export const realParticipant = sql`NOT EXISTS (SELECT 1 FROM audit_logs test_account WHERE test_account.target_id = ${participants.id} AND test_account.action = 'PARTICIPANT_TEST_ACCOUNT')`;
export const testParticipant = sql<boolean>`NOT (${realParticipant})`;
