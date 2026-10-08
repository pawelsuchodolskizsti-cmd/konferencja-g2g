import { z } from "zod";
import QRCode from "qrcode";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, participants } from "@/db/schema";
import { requireAdmin, requireEvent, requestOrigin } from "@/server/auth";
import { adminEventList, saveEvent } from "@/server/events";
import { commitImport, previewImport } from "@/server/imports";
import { checkIn } from "@/server/attendance";
import { createCourse, importCodes, updateCourse } from "@/server/training";
import { exportTickets } from "@/server/ticket-export";
import {
  deleteEventData,
  deleteParticipant,
  eventOverview,
  exportAttendance,
  updateParticipant,
} from "@/server/admin-data";
import { apiError, jsonBody, uploadBody } from "@/server/http";
import { uploadMaterial } from "@/server/materials";
import { AppError, assert } from "@/server/errors";
import { surveyOverview, saveSurvey, exportSurvey } from "@/server/surveys";
type Context = { params: Promise<{ path: string[] }> };
export const runtime = "nodejs";
export const maxDuration = 60;
async function handle(req: Request, ctx: Context) {
  try {
    const admin = await requireAdmin();
    if (req.method !== "GET") requestOrigin(req);
    const { path } = await ctx.params;
    assert(path[0] === "events", 404, "Nie znaleziono.");
    if (path.length === 1) {
      if (req.method === "GET")
        return Response.json(await adminEventList(admin.id));
      throw new AppError(
        405,
        "Panel obsługuje jedną konferencję. Użyj jej ustawień.",
      );
    }
    if (path.length === 2 && path[1] === "setup" && req.method === "POST")
      return Response.json(await saveEvent(admin.id, await jsonBody(req)), {
        status: 201,
      });
    const eventId = z.uuid().parse(path[1]);
    await requireEvent(admin.id, eventId);
    const action = path[2];
    if (action === "survey" && req.method === "GET")
      return Response.json(await surveyOverview(eventId), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (action === "survey" && req.method === "POST")
      return Response.json(
        await saveSurvey(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "survey-export" && req.method === "GET")
      return await exportSurvey(eventId, admin.id);
    if (!action && req.method === "GET")
      return Response.json(await eventOverview(eventId));
    if (!action && req.method === "PATCH")
      return Response.json(
        await saveEvent(admin.id, await jsonBody(req), eventId),
      );
    if (action === "program-qr" && req.method === "GET") {
      const [event] = await db()
        .select({ slug: events.slug })
        .from(events)
        .where(eq(events.id, eventId));
      assert(event && process.env.APP_URL, 404, "Brak wydarzenia.");
      const qr = await QRCode.toBuffer(
        `${new URL(process.env.APP_URL).origin}/wydarzenie/${event.slug}`,
        { width: 1000, margin: 3 },
      );
      return new Response(new Uint8Array(qr), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": 'attachment; filename="program-qr.png"',
        },
      });
    }
    if (action === "export" && req.method === "GET")
      return exportAttendance(eventId);
    if (action === "import" && req.method === "POST")
      return Response.json(
        await previewImport(eventId, admin.id, await uploadBody(req)),
      );
    if (action === "import-confirm" && req.method === "POST") {
      const { batchId } = z
        .object({ batchId: z.uuid() })
        .parse(await jsonBody(req));
      return Response.json(await commitImport(batchId, eventId, admin.id));
    }
    if (action === "checkin" && req.method === "POST") {
      const input = z
        .union([
          z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
          z.object({ participantId: z.uuid() }),
        ])
        .parse(await jsonBody(req));
      return Response.json(await checkIn(eventId, admin.id, input));
    }
    if (action === "mail" || action === "mail-preview")
      throw new AppError(
        410,
        "Wysyłka z panelu została wyłączona. Pobierz dane w sekcji Kody i eksport.",
      );
    if (action === "codes-export" && req.method === "GET") {
      const url = new URL(req.url);
      const format = z
        .enum(["xlsx", "csv", "zip"])
        .parse(url.searchParams.get("format") || "xlsx");
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(url.searchParams.get("offset") || 0);
      return await exportTickets(eventId, admin.id, format, offset);
    }
    if (action === "materials" && req.method === "POST")
      return Response.json(
        await uploadMaterial(eventId, admin.id, await uploadBody(req)),
      );
    if (action === "courses" && !path[3] && req.method === "POST")
      return Response.json(
        await createCourse(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "courses" && path[3] && !path[4] && req.method === "PATCH")
      return Response.json(
        await updateCourse(
          eventId,
          admin.id,
          z.uuid().parse(path[3]),
          await jsonBody(req),
        ),
      );
    if (action === "courses" && path[4] === "codes" && req.method === "POST")
      return Response.json(
        await importCodes(
          eventId,
          admin.id,
          z.uuid().parse(path[3]),
          await uploadBody(req),
        ),
      );
    if (action === "participants") {
      const id = z.uuid().parse(path[3]);
      const [p] = await db()
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.id, id), eq(participants.eventId, eventId)));
      assert(p, 404, "Brak uczestnika.");
      if (req.method === "PATCH")
        return Response.json(
          await updateParticipant(eventId, admin.id, id, await jsonBody(req)),
        );
      if (req.method === "DELETE")
        return Response.json(await deleteParticipant(eventId, admin.id, id));
    }
    if (action === "purge" && req.method === "POST") {
      const { confirmation } = z
        .object({ confirmation: z.string() })
        .parse(await jsonBody(req));
      return Response.json(
        await deleteEventData(eventId, admin.id, confirmation),
      );
    }
    throw new AppError(404, "Nie znaleziono operacji.");
  } catch (error) {
    return apiError(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
