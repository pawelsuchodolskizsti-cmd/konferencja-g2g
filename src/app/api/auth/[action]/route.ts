import { z } from "zod";
import { jsonBody } from "@/server/http";
import { AppError } from "@/server/errors";
import {
  requestOrigin,
  clientKey,
  loginAdmin,
  loginParticipant,
  logout,
} from "@/server/auth";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    requestOrigin(req);
    const { action } = await params;
    if (action === "logout-admin" || action === "logout-participant") {
      await logout(action === "logout-admin");
      return Response.json({ ok: true });
    }
    const data = await jsonBody(req);
    if (action === "admin") {
      const input = z
        .object({
          email: z.email().transform((v) => v.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .parse(data);
      await loginAdmin(input.email, input.password, clientKey(req));
    } else if (action === "participant") {
      const input = z.object({ code: z.string().min(1).max(100) }).parse(data);
      await loginParticipant(input.code, clientKey(req));
    } else throw new AppError(404, "Nie znaleziono.");
    return Response.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : status === 400
              ? "Sprawdź wpisane dane."
              : "Logowanie jest chwilowo niedostępne. Spróbuj później.",
      },
      { status },
    );
  }
}
