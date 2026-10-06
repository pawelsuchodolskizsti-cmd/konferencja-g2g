import { beforeAll, expect, test } from "vitest";
import {
  encrypt,
  decrypt,
  hashToken,
  newCredentials,
  normalizeCode,
  passwordHash,
  verifyPassword,
} from "../src/server/crypto";
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper-".repeat(8);
});
test("credentials use independent unpredictable tokens with authenticated encryption", () => {
  const a = newCredentials();
  const b = newCredentials();
  expect(a.accessHash).not.toBe(b.accessHash);
  const raw = JSON.parse(decrypt(a.credentials));
  expect(raw.accessCode).toMatch(/^[A-Z0-9]{6}$/);
  expect(raw.qrToken).toHaveLength(43);
  expect(hashToken(normalizeCode(raw.accessCode))).toBe(a.accessHash);
  expect(hashToken(raw.qrToken)).toBe(a.qrHash);
  expect(() => decrypt(encrypt("private").slice(0, -3) + "AAA")).toThrow();
});
test("password verification rejects incorrect password", () => {
  const hash = passwordHash("long-password-example");
  expect(verifyPassword("wrong", hash)).toBe(false);
  expect(verifyPassword("long-password-example", hash)).toBe(true);
});
