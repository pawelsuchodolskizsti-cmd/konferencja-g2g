import type { ConnectionOptions } from "node:tls";

/** Only isolated loopback development databases may omit TLS. */
export function databaseTls(
  url: string,
  env: Record<string, string | undefined> = process.env,
): ConnectionOptions | false {
  const host = new URL(url).hostname;
  if (
    env.APP_ENV === "development" &&
    !env.VERCEL &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    return false;
  // An explicit object overrides sslmode=require in postgres.js. Node verifies
  // both the certificate chain and the hostname supplied by the driver.
  return { rejectUnauthorized: true, minVersion: "TLSv1.2" };
}
