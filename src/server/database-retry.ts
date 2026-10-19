import { setTimeout } from "node:timers/promises";
import { operationalError } from "./operational-error";

const rolledBack = new Set([
  "40001",
  "40P01",
  "53300",
  "57P03",
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
]);
const disconnected = new Set([
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);
export function transientDatabaseError(error: unknown, idempotent: boolean) {
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    const item = current as { code?: string; cause?: unknown };
    if (
      item.code &&
      (rolledBack.has(item.code) || (idempotent && disconnected.has(item.code)))
    )
      return true;
    current = item.cause;
  }
  return false;
}
// Ambiguous connection failures are retried only for reads or explicitly
// idempotent transactions. Never replay a rate-limit increment after one.
export async function retryDatabase<T>(
  operation: string,
  run: () => Promise<T>,
  idempotent = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 2 || !transientDatabaseError(error, idempotent))
        throw error;
      operationalError(`${operation}:retry`, error);
      await setTimeout(100 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
  }
}
