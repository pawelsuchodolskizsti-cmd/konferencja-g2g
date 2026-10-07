import { requireParticipant, requestOrigin, limit } from "@/server/auth";
import { participantCourses } from "@/server/training";
import { generateCertificate } from "@/server/certificates";
import { apiError } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const person = await requireParticipant();
    const { action } = await ctx.params;
    if (action === "courses")
      return Response.json(await participantCourses(person.id));
    if (action === "certificate") {
      await limit(`pdf:${person.id}`, 10, 60);
      const { pdf } = await generateCertificate(person.id);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="certyfikat.pdf"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    throw new AppError(404, "Nie znaleziono.");
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    requestOrigin(req);
    await requireParticipant();
    const { action } = await ctx.params;
    if (action === "certificate-email")
      throw new AppError(
        410,
        "Wysyłka e-mail jest wyłączona. Pobierz certyfikat PDF w swojej strefie.",
      );
    throw new AppError(404, "Nie znaleziono.");
  } catch (error) {
    return apiError(error);
  }
}
