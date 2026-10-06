import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
function encryptionKey() {
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(key, "hex");
}
export function hashToken(value: string) {
  const key = process.env.TOKEN_PEPPER;
  if (!key || key.length < 32) throw new Error("TOKEN_PEPPER missing");
  return createHmac("sha256", key).update(value).digest("hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString(
    "base64url",
  );
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function newCredentials() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const accessCode = Array.from(
    { length: 6 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
  const qrToken = randomBytes(32).toString("base64url");
  return {
    accessHash: hashToken(normalizeCode(accessCode)),
    qrHash: hashToken(qrToken),
    credentials: encrypt(JSON.stringify({ accessCode, qrToken })),
  };
}
export function normalizeCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const a = scryptSync(password, salt, 64);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
