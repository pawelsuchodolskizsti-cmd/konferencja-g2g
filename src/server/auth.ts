import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  admins,
  attendance,
  adminEvents,
  participants,
  rateLimits,
  sessions,
} from "@/db/schema";
import {
  hashToken,
  normalizeCode,
  passwordHash,
  verifyPassword,
} from "./crypto";
import { assert } from "./errors";

const dummyHash = passwordHash("unused-constant-for-timing-only");
export async function limit(
  key: string,
  maximum: number,
  seconds: number,
  database: Database = db(),
) {
  const now = new Date();
  const [row] = await database
    .insert(rateLimits)
    .values({
      key: hashToken(key),
      count: 1,
      resetsAt: new Date(now.getTime() + seconds * 1000),
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.resetsAt} <= ${now.toISOString()} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetsAt: sql`CASE WHEN ${rateLimits.resetsAt} <= ${now.toISOString()} THEN ${new Date(now.getTime() + seconds * 1000).toISOString()} ELSE ${rateLimits.resetsAt} END`,
      },
    })
    .returning();
  assert(
    row.count <= maximum,
    429,
    "Zbyt wiele prób. Spróbuj ponownie za kilka minut.",
  );
}
export async function createSession(
  subject: { adminId: string } | { participantId: string },
) {
  const token = randomBytes(32).toString("base64url");
  const admin = "adminId" in subject;
  const maxAge = admin ? 8 * 3600 : 24 * 3600;
  await db()
    .insert(sessions)
    .values({
      ...subject,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + maxAge * 1000),
    });
  (await cookies()).set(
    admin ? "admin_session" : "participant_session",
    token,
    {
      httpOnly: true,
      secure: process.env.APP_URL?.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge,
    },
  );
}
async function getSession(admin: boolean) {
  const token = (await cookies()).get(
    admin ? "admin_session" : "participant_session",
  )?.value;
  if (!token || token.length !== 43) return null;
  const [row] = await db()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row;
}
export async function requireAdmin() {
  const session = await getSession(true);
  assert(session?.adminId, 401, "Zaloguj się do panelu administratora.");
  const [admin] = await db()
    .select({ id: admins.id, email: admins.email })
    .from(admins)
    .where(and(eq(admins.id, session.adminId), eq(admins.active, true)));
  assert(admin, 401, "Sesja wygasła. Zaloguj się ponownie.");
  return admin;
}
export async function requireEvent(
  adminId: string,
  eventId: string,
  database: Database = db(),
) {
  const [access] = await database
    .select()
    .from(adminEvents)
    .where(
      and(eq(adminEvents.adminId, adminId), eq(adminEvents.eventId, eventId)),
    );
  assert(access, 403, "Brak dostępu do tego wydarzenia.");
}
export async function requireParticipant() {
  const session = await getSession(false);
  assert(session?.participantId, 401, "Wpisz kod uczestnika.");
  const [person] = await db()
    .select()
    .from(participants)
    .where(eq(participants.id, session.participantId));
  assert(person, 401, "Sesja wygasła.");
  await requireAttendance(person.id);
  return person;
}
async function requireAttendance(participantId: string) {
  const [present] = await db()
    .select({ participantId: attendance.participantId })
    .from(attendance)
    .where(eq(attendance.participantId, participantId))
    .limit(1);
  assert(
    present,
    403,
    "Panel jest dostępny po zeskanowaniu biletu i potwierdzeniu obecności. Zgłoś się do obsługi konferencji.",
  );
}
export function requestOrigin(req: Request) {
  const expected = process.env.APP_URL;
  assert(expected, 503, "Brak konfiguracji adresu aplikacji.");
  assert(
    req.headers.get("origin") === new URL(expected).origin,
    403,
    "Nieprawidłowe pochodzenie żądania.",
  );
}
export function clientKey(req: Request) {
  // Vercel sets this header. Other reverse proxies must overwrite it too.
  return process.env.VERCEL
    ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    : "local";
}
export async function loginAdmin(email: string, password: string, ip: string) {
  await limit(`admin-ip:${ip}`, 30, 900);
  await limit(`admin-email:${email}`, 8, 900);
  const [admin] = await db()
    .select()
    .from(admins)
    .where(eq(admins.email, email));
  const valid = verifyPassword(password, admin?.passwordHash || dummyHash);
  assert(valid && admin?.active, 401, "Nieprawidłowy e-mail lub hasło.");
  await createSession({ adminId: admin.id });
}
export async function loginParticipant(code: string, ip: string) {
  await limit(`participant-ip:${ip}`, 20, 900);
  const normalized = normalizeCode(code);
  assert(
    /^(?:[A-Z0-9]{6}|[A-F0-9]{32})$/.test(normalized),
    401,
    "Nieprawidłowy kod uczestnika.",
  );
  const [person] = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.accessHash, hashToken(normalized)));
  assert(person, 401, "Nieprawidłowy kod uczestnika.");
  await requireAttendance(person.id);
  await createSession({ participantId: person.id });
}
export async function logout(admin: boolean) {
  const name = admin ? "admin_session" : "participant_session";
  const jar = await cookies();
  const token = jar.get(name)?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(name);
}
