import { z } from "zod";
import { AppError, assert } from "./errors";
export async function readBody(req: Request, maximum = 3 * 1024 * 1024) {
  assert(
    Number(req.headers.get("content-length") || 0) <= maximum,
    413,
    "Za duże żądanie.",
  );
  const reader = req.body?.getReader();
  assert(reader, 400, "Brak danych.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError(413, "Za duże żądanie.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req: Request) {
  return JSON.parse((await readBody(req, 100000)).toString("utf8"));
}
export async function uploadBody(req: Request) {
  const buffer = await readBody(req);
  const form = await new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": req.headers.get("content-type") || "" },
  }).formData();
  const file = form.get("file");
  assert(file instanceof File, 400, "Wybierz plik.");
  return file;
}
export function apiError(error: unknown) {
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 500;
  const cause = error as { code?: string; cause?: { code?: string } };
  if (cause?.code === "23505" || cause?.cause?.code === "23505")
    return Response.json(
      {
        error:
          "Taki rekord już istnieje. Sprawdź e-mail lub identyfikator wydarzenia.",
      },
      { status: 409 },
    );
  return Response.json(
    {
      error:
        error instanceof AppError
          ? error.message
          : error instanceof z.ZodError
            ? error.issues[0]?.message
            : status === 400
              ? "Nieprawidłowe dane."
              : "Operacja nie powiodła się. Spróbuj ponownie.",
    },
    { status },
  );
}
