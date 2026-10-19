import { expect, test, vi } from "vitest";
import {
  retryDatabase,
  transientDatabaseError,
} from "../src/server/database-retry";
test("retries a transient rejection with a bounded attempt count", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const run = vi
      .fn()
      .mockRejectedValueOnce({ cause: { code: "53300" } })
      .mockResolvedValue("ok");
    expect(await retryDatabase("test", run)).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    const broken = vi.fn().mockRejectedValue({ code: "53300" });
    await expect(retryDatabase("test", broken)).rejects.toMatchObject({
      code: "53300",
    });
    expect(broken).toHaveBeenCalledTimes(3);
  } finally {
    log.mockRestore();
  }
});
test("never replays ambiguous mutations, authorization failures or invalid data", async () => {
  for (const error of [
    { code: "ECONNRESET" },
    { status: 403 },
    { code: "23505" },
    { code: "23503" },
  ]) {
    const run = vi.fn().mockRejectedValue(error);
    await expect(retryDatabase("test", run)).rejects.toEqual(error);
    expect(run).toHaveBeenCalledTimes(1);
  }
  expect(transientDatabaseError({ cause: { code: "ECONNRESET" } }, true)).toBe(
    true,
  );
  expect(transientDatabaseError({ status: 403 }, true)).toBe(false);
});
