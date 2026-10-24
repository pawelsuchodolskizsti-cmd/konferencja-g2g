import { expect, test } from "vitest";
import postgres from "postgres";
import { databaseTls } from "../src/db/tls";
import { enforcedCsp } from "../src/lib/security-headers";

test.each(["require", "disable", "prefer", "allow"])(
  "TLS validation overrides URL sslmode=%s",
  async (mode) => {
    const url = `postgres://test:test@db.example.test/test?sslmode=${mode}`;
    const client = postgres(url, {
      ssl: databaseTls(url, { APP_ENV: "production" }),
    });
    expect(client.options.ssl).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    await client.end();
  },
);
test("TLS exception is restricted to loopback development outside Vercel", () => {
  expect(
    databaseTls("postgres://localhost/test", { APP_ENV: "development" }),
  ).toBe(false);
  for (const env of [
    { APP_ENV: "production" },
    { APP_ENV: "development", VERCEL: "1" },
    {},
  ])
    expect(databaseTls("postgres://localhost/test", env)).toMatchObject({
      rejectUnauthorized: true,
    });
  expect(
    databaseTls("postgres://remote.example/test", { APP_ENV: "development" }),
  ).toMatchObject({ rejectUnauthorized: true });
});
test("CSP enforces resource origins and blocks inline event handlers while preserving scanner and PDF blobs", () => {
  expect(enforcedCsp).toContain("frame-ancestors 'none'");
  expect(enforcedCsp).toContain("object-src 'none'");
  expect(enforcedCsp).toContain("form-action 'self'");
  expect(enforcedCsp).toContain("script-src");
  expect(enforcedCsp).toContain("script-src-attr 'none'");
  expect(enforcedCsp).toContain("worker-src 'self' blob:");
  expect(enforcedCsp).toContain("connect-src 'self'");
  expect(enforcedCsp).not.toContain("'unsafe-eval'");
});
