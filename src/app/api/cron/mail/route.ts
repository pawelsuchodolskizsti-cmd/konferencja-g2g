import { timingSafeEqual } from "node:crypto";
import { cleanupEphemeral, processMail } from "@/server/mail";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    !secret ||
    secret.length < 32 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await cleanupEphemeral();
    return Response.json(await processMail());
  } catch {
    return Response.json({ error: "Worker unavailable" }, { status: 503 });
  }
}
