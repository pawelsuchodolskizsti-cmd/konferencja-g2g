import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { materials, auditLogs } from "@/db/schema";
import { encrypt, decrypt } from "./crypto";
import { assert } from "./errors";
const rows = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result)
    ? result
    : (result as { rows: Record<string, unknown>[] }).rows;
export async function beginMaterialUpload(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const value = z
    .object({
      filename: z
        .string()
        .min(1)
        .max(200)
        .regex(/\.pdf$/i),
      size: z
        .number()
        .int()
        .min(1)
        .max(20 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  const id = randomUUID();
  await db().transaction(async (tx) => {
    await tx.execute(
      sql`DELETE FROM material_uploads WHERE expires_at < now()`,
    );
    const active = rows(
      await tx.execute(
        sql`SELECT count(*)::int AS n FROM material_uploads WHERE admin_id=${adminId} AND material_id IS NULL`,
      ),
    );
    assert(
      Number(active[0].n) < 5,
      429,
      "Dokończ rozpoczęte przesyłanie lub spróbuj za godzinę.",
    );
    await tx.execute(
      sql`INSERT INTO material_uploads (id,event_id,admin_id,filename,size,sha256,expires_at) VALUES (${id},${eventId},${adminId},${value.filename},${value.size},${value.sha256},now()+interval '1 hour')`,
    );
  });
  return { id, chunkSize: 1024 * 1024 };
}
export async function appendMaterialChunk(
  eventId: string,
  adminId: string,
  id: string,
  index: number,
  bytes: Buffer,
) {
  assert(
    Number.isInteger(index) &&
      index >= 0 &&
      bytes.length > 0 &&
      bytes.length <= 1024 * 1024,
    400,
    "Nieprawidłowa część pliku.",
  );
  return db().transaction(async (tx) => {
    const [upload] = rows(
      await tx.execute(
        sql`SELECT * FROM material_uploads WHERE id=${id} AND event_id=${eventId} AND admin_id=${adminId} AND expires_at>now() FOR UPDATE`,
      ),
    );
    assert(
      upload && !upload.material_id,
      409,
      "Przesyłanie wygasło lub zostało zakończone.",
    );
    const chunks = upload.chunks as string[];
    if (index < chunks.length) {
      assert(
        Buffer.from(decrypt(chunks[index]), "base64").equals(bytes),
        409,
        "Niezgodna ponowiona część pliku.",
      );
      return { received: index + 1 };
    }
    assert(
      index === chunks.length &&
        bytes.length ===
          Math.min(1024 * 1024, Number(upload.size) - index * 1024 * 1024),
      400,
      "Nieprawidłowa kolejność lub rozmiar części.",
    );
    chunks.push(encrypt(bytes.toString("base64")));
    await tx.execute(
      sql`UPDATE material_uploads SET chunks=${JSON.stringify(chunks)}::jsonb WHERE id=${id}`,
    );
    return { received: chunks.length };
  });
}
export async function finishMaterialUpload(
  eventId: string,
  adminId: string,
  id: string,
) {
  return db().transaction(async (tx) => {
    const [upload] = rows(
      await tx.execute(
        sql`SELECT * FROM material_uploads WHERE id=${id} AND event_id=${eventId} AND admin_id=${adminId} AND expires_at>now() FOR UPDATE`,
      ),
    );
    assert(upload, 404, "Brak przesyłanego pliku.");
    if (upload.material_id)
      return { id: upload.material_id, sha256: upload.sha256 };
    const bytes = Buffer.concat(
      (upload.chunks as string[]).map((c) => Buffer.from(decrypt(c), "base64")),
    );
    assert(
      bytes.length === Number(upload.size) &&
        createHash("sha256").update(bytes).digest("hex") === upload.sha256,
      400,
      "Plik nie jest kompletny lub suma kontrolna jest niezgodna.",
    );
    assert(
      bytes.subarray(0, 5).toString() === "%PDF-",
      400,
      "Nieprawidłowy plik PDF.",
    );
    const [material] = await tx
      .insert(materials)
      .values({
        eventId,
        title: String(upload.filename)
          .replace(/\.pdf$/i, "")
          .slice(0, 160),
        filename: String(upload.filename),
        mimeType: "application/pdf",
        encryptedContent: encrypt(bytes.toString("base64")),
        published: true,
      })
      .returning({ id: materials.id });
    await tx.execute(
      sql`UPDATE material_uploads SET material_id=${material.id},chunks='[]'::jsonb WHERE id=${id}`,
    );
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "MATERIAL_UPLOADED",
        targetId: material.id,
      });
    return { id: material.id, sha256: upload.sha256 };
  });
}
