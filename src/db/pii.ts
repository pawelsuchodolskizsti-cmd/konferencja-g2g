import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

export const PII_PREFIX = "g2g:pii:v1:";
function key() {
  const master = process.env.DATA_ENCRYPTION_KEY;
  if (!master || !/^[a-f0-9]{64}$/i.test(master))
    throw new Error("PII encryption key unavailable");
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(master, "hex"),
      "g2g-pii-v1",
      "participant-fields",
      32,
    ),
  );
}
export function sealPii(value: string, field: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(field));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return (
    PII_PREFIX +
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  );
}
export function openPii(value: string, field: string): string {
  // Temporary legacy read compatibility also permits a safe staged deployment.
  if (!value.startsWith(PII_PREFIX)) return value;
  try {
    const data = Buffer.from(value.slice(PII_PREFIX.length), "base64url");
    if (data.length < 28) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    cipher.setAAD(Buffer.from(field));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Cannot decrypt protected participant data");
  }
}
export const protectedText = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => sealPii(value, name),
    fromDriver: (value) => openPii(value, name),
  })(name);

export function sealImportRows(value: unknown) {
  return { g2gEncryptedRows: sealPii(JSON.stringify(value), "import_rows") };
}
export function openImportRows(value: unknown): unknown {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    "g2gEncryptedRows" in parsed &&
    typeof parsed.g2gEncryptedRows === "string" &&
    parsed.g2gEncryptedRows.startsWith(PII_PREFIX)
  )
    return JSON.parse(openPii(parsed.g2gEncryptedRows, "import_rows"));
  throw new Error("Invalid protected import data");
}
export const protectedImportRows = customType<{
  data: import("./schema").ImportRow[];
  driverData: string;
}>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(sealImportRows(value)),
  fromDriver: (value) =>
    openImportRows(value) as import("./schema").ImportRow[],
});
