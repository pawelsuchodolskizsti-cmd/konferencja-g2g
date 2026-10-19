import { pdfDownload } from "@/server/pdf-download";
import {
  smtpOverview, saveSmtpPassword, removeSmtpPassword, saveSmtpTemplate,
  startSmtpCampaign, processSmtpBatch, checkSmtpCredentials,
} from "@/server/smtp-campaign";
import {
  listArchives,
  createArchive,
  downloadArchive,
  removeArchive,
  cleanupPreview,
  clearSelectedParticipants,
} from "@/server/data-archives";
import { adminPermission } from "@/lib/admin-permissions";
import {
  audit,
  cleanupData,
  createParticipant,
  csvResponse,
  exportReport,
  history,
  invitationConfig,
  manageMaterial,
  participantRecord,
  personalData,
  privacyOverview,
  resetCredentials,
  removeTeamMember,
  saveInvitation,
  savePrivacyRequest,
  saveTeamMember,
  selectionFrom,
  selectedPeople,
  teamOverview,
  undoAttendance,
} from "@/server/admin-operations";
import { generateCertificate } from "@/server/certificates";
import { surveySummary } from "@/server/surveys";
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
    if (path.length === 2 && path[1] === "setup" && req.method === "POST") {
      const memberships = await adminEventList(admin.id);
      assert(
        !memberships.length || memberships.some((e) => e.role === "ADMIN"),
        403,
        "Ta operacja wymaga administratora konferencji.",
      );
      return Response.json(await saveEvent(admin.id, await jsonBody(req)), {
        status: 201,
      });
    }
    const eventId = z.uuid().parse(path[1]);
    const action = path[2];
    await requireEvent(
      admin.id,
      eventId,
      db(),
      adminPermission(req.method, path),
    );
    if (action === "archives") {
      if (path.length === 3 && req.method === "GET")
        return Response.json(await listArchives(eventId), {
          headers: { "Cache-Control": "private, no-store" },
        });
      if (path.length === 3 && req.method === "POST")
        return Response.json(await createArchive(eventId, admin.id), {
          status: 201,
        });
      if (path.length === 4 && req.method === "GET")
        return await downloadArchive(
          eventId,
          admin.id,
          z.uuid().parse(path[3]),
        );
      if (path.length === 4 && req.method === "DELETE")
        return Response.json(
          await removeArchive(
            eventId,
            admin.id,
            z.uuid().parse(path[3]),
            await jsonBody(req),
          ),
        );
    }
    if (action === "data-cleanup" && req.method === "POST") {
      if (path.length === 4 && path[3] === "preview")
        return Response.json(
          await cleanupPreview(eventId, await jsonBody(req)),
        );
      if (path.length === 3)
        return Response.json(
          await clearSelectedParticipants(
            eventId,
            admin.id,
            await jsonBody(req),
          ),
        );
    }
    const url = new URL(req.url);
    const exportAction = ["export", "codes-export", "reports"].includes(action);
    if (exportAction && req.method === "POST") {
      const params = z
        .record(z.string(), z.string().max(100000))
        .parse(await jsonBody(req));
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    }
    const selection = () => selectionFrom(url);
    if (action === "survey" && req.method === "GET")
      return Response.json(await surveyOverview(eventId), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (action === "survey" && req.method === "POST")
      return Response.json(
        await saveSurvey(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "survey-export" && req.method === "GET")
      return await exportSurvey(
        eventId,
        admin.id,
        z.enum(["csv", "xlsx"]).parse(url.searchParams.get("format") || "xlsx"),
      );
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
    if (action === "export" && ["GET", "POST"].includes(req.method))
      return await exportReport(eventId, admin.id, "attendance", selection());
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
    if (action === "checkin-people" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      assert(
        q.length >= 2 && q.length <= 100,
        400,
        "Wpisz co najmniej 2 znaki.",
      );
      const people = await selectedPeople(eventId, { q });
      return Response.json(
        people.slice(0, 20).map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          checkedInAt: p.checkedInAt,
        })),
        { headers: { "Cache-Control": "private, no-store" } },
      );
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
    if (action === "smtp" && path.length === 3) {
      if (req.method === "GET")
        return Response.json(await smtpOverview(eventId), { headers: { "Cache-Control": "private, no-store" } });
      if (req.method === "POST")
        return Response.json(await saveSmtpPassword(eventId, admin.id, await jsonBody(req)));
      if (req.method === "DELETE")
        return Response.json(await removeSmtpPassword(eventId, admin.id));
    }
    if (action === "smtp-verify" && path.length === 3 && req.method === "POST")
      return Response.json(await checkSmtpCredentials(eventId));
    if (action === "smtp-template" && path.length === 3 && req.method === "POST")
      return Response.json(await saveSmtpTemplate(eventId, admin.id, await jsonBody(req)));
    if (action === "smtp-queue" && path.length === 3 && req.method === "POST")
      return Response.json(await startSmtpCampaign(eventId, admin.id));
    if (action === "smtp-process" && path.length === 3 && req.method === "POST")
      return Response.json(await processSmtpBatch(eventId, admin.id));
    if (action === "mail" || action === "mail-preview")
      throw new AppError(
        410,
        "Wysyłka z panelu została wyłączona. Pobierz dane w sekcji Kody i eksport.",
      );
    if (action === "codes-export" && ["GET", "POST"].includes(req.method)) {
      const format = z
        .enum(["xlsx", "csv", "zip", "pdf"])
        .parse(url.searchParams.get("format") || "xlsx");
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(url.searchParams.get("offset") || 0);
      return await exportTickets(
        eventId,
        admin.id,
        format,
        offset,
        selection(),
      );
    }
    if (action === "materials" && path[3])
      return await manageMaterial(
        eventId,
        admin.id,
        z.uuid().parse(path[3]),
        req.method,
        req.method === "PATCH" ? await jsonBody(req) : undefined,
        req.method === "POST" ? await uploadBody(req) : undefined,
      );
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
    if (action === "survey-summary" && req.method === "GET")
      return Response.json(await surveySummary(eventId));
    if (action === "reports" && ["GET", "POST"].includes(req.method))
      return await exportReport(
        eventId,
        admin.id,
        z
          .enum(["attendance", "certificates", "privacy"])
          .parse(url.searchParams.get("kind")),
        selection(),
      );
    if (action === "history" && req.method === "GET") {
      const rows = await history(eventId, url);
      return url.searchParams.get("format") === "csv"
        ? csvResponse(
            [
              ["Data UTC", "Operacja", "Administrator", "Id rekordu"],
              ...rows.map((r) => [
                r.createdAt.toISOString(),
                r.action,
                r.adminEmail,
                r.targetId,
              ]),
            ],
            "historia.csv",
          )
        : Response.json(rows);
    }
    if (action === "privacy" && req.method === "GET")
      return Response.json(await privacyOverview(eventId));
    if (action === "privacy" && req.method === "POST")
      return Response.json(
        await savePrivacyRequest(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "cleanup" && req.method === "POST")
      return Response.json(await cleanupData(eventId, admin.id));
    if (action === "team" && path[3] && req.method === "DELETE")
      return Response.json(
        await removeTeamMember(eventId, admin.id, z.uuid().parse(path[3])),
      );
    if (action === "team" && req.method === "GET")
      return Response.json(await teamOverview(eventId));
    if (action === "team" && req.method === "POST")
      return Response.json(
        await saveTeamMember(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "invitation" && req.method === "GET")
      return Response.json(await invitationConfig(eventId));
    if (action === "invitation" && req.method === "POST")
      return Response.json(
        await saveInvitation(eventId, admin.id, await jsonBody(req)),
      );
    if (action === "participants" && !path[3] && req.method === "POST")
      return Response.json(
        await createParticipant(eventId, admin.id, await jsonBody(req)),
        { status: 201 },
      );
    if (action === "participants") {
      const id = z.uuid().parse(path[3]);
      const [p] = await db()
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.id, id), eq(participants.eventId, eventId)));
      assert(p, 404, "Brak uczestnika.");
      if (path[4] === "data" && req.method === "GET")
        return await personalData(eventId, admin.id, id);
      if (path[4] === "reset" && req.method === "POST")
        return Response.json(
          await resetCredentials(eventId, admin.id, id, await jsonBody(req)),
        );
      if (path[4] === "undo-checkin" && req.method === "POST")
        return Response.json(
          await undoAttendance(eventId, admin.id, id, await jsonBody(req)),
        );
      if (path[4] === "certificate" && req.method === "GET") {
        await participantRecord(eventId, id);
        const { parts } = await generateCertificate(id);
        await audit(eventId, admin.id, "ADMIN_CERTIFICATE_DOWNLOADED", id);
        return pdfDownload(req, parts);
      }
      assert(!path[4], 404, "Nie znaleziono operacji.");
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
