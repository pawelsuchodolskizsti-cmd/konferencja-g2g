import { customType } from "drizzle-orm/pg-core";
import { openPii, sealPii, PII_PREFIX } from "./pii.ts";

// Keep the operation prefix queryable; protect all recipient/diagnostic details.
// Reads preserve the exact original action, including legacy plaintext rows.
const sensitiveAction = /^(SMTP_(?:SELECTED|TEST)_[A-Z_]+ )(.*)$/s;
export function sealAuditAction(value: string) {
  const match = sensitiveAction.exec(value);
  if (!match) return value;
  const details = match[2];
  if (details.startsWith(PII_PREFIX)) {
    openPii(details, "audit_action_details");
    return value;
  }
  return match[1] + sealPii(details, "audit_action_details");
}
export function openAuditAction(value: string) {
  const match = sensitiveAction.exec(value);
  return match ? match[1] + openPii(match[2], "audit_action_details") : value;
}
export const protectedAuditAction = customType<{
  data: string;
  driverData: string;
}>({
  dataType: () => "text",
  toDriver: sealAuditAction,
  fromDriver: openAuditAction,
});
