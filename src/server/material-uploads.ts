import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { materials, auditLogs } from "@/db/schema";
import { encrypt, decrypt } from "./crypto";
import { assert } from "./errors";
import { MATERIAL_CHUNKS } from "./material-content";
const rows = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result)
    ? result
    : (result as { rows: Record<string, unknown>[] }).rows;
const CHUNK = 1024 * 1024;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

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
      size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      replacesId: z.uuid().optional(),
    })
    .strict()
    .parse(input);
  const id = randomUUID();
  await db().transaction(async (tx) => {
    // Completed versions are retained, so an in-flight download survives replacement.
    await tx.execute(
      sql`DELETE FROM material_uploads WHERE expires_at < now() AND material_id IS NULL`,
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
    let expected: string | null = null;
    if (value.replacesId) {
      const [item] = await tx
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.id, value.replacesId),
            eq(materials.eventId, eventId),
          ),
        );
      assert(item, 404, "Brak materiału w tej konferencji.");
      expected = digest(item.encryptedContent);
    }
    await tx.execute(
      sql`INSERT INTO material_uploads (id,event_id,admin_id,filename,size,sha256,expires_at,replaces_id,expected_content_hash) VALUES (${id},${eventId},${adminId},${value.filename},${value.size},${value.sha256},now()+interval '1 hour',${value.replacesId ?? null},${expected})`,
    );
  });
  return { id, chunkSize: CHUNK };
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
      bytes.length <= CHUNK,
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
    // Resume a session started by the previous app without changing original bytes.
    const legacy = upload.chunks as string[];
    for (let i = 0; i < legacy.length; i++)
      await tx.execute(
        sql`INSERT INTO material_upload_parts (upload_id,part,encrypted_content) VALUES (${id},${i},${legacy[i]}) ON CONFLICT DO NOTHING`,
      );
    if (legacy.length)
      await tx.execute(
        sql`UPDATE material_uploads SET chunks='[]'::jsonb WHERE id=${id}`,
      );
    const [count] = rows(
      await tx.execute(
        sql`SELECT count(*)::int AS n FROM material_upload_parts WHERE upload_id=${id}`,
      ),
    );
    const received = Number(count.n);
    if (index < received) {
      const [stored] = rows(
        await tx.execute(
          sql`SELECT encrypted_content FROM material_upload_parts WHERE upload_id=${id} AND part=${index}`,
        ),
      );
      assert(
        stored &&
          Buffer.from(
            decrypt(String(stored.encrypted_content)),
            "base64",
          ).equals(bytes),
        409,
        "Niezgodna ponowiona część pliku.",
      );
      return { received: index + 1 };
    }
    assert(
      index === received &&
        bytes.length === Math.min(CHUNK, Number(upload.size) - index * CHUNK),
      400,
      "Nieprawidłowa kolejność lub rozmiar części.",
    );
    await tx.execute(
      sql`INSERT INTO material_upload_parts (upload_id,part,encrypted_content) VALUES (${id},${index},${encrypt(bytes.toString("base64"))})`,
    );
    await tx.execute(
      sql`UPDATE material_uploads SET expires_at=now()+interval '1 hour' WHERE id=${id}`,
    );
    return { received: received + 1 };
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
    const legacy = upload.chunks as string[];
    for (let i = 0; i < legacy.length; i++)
      await tx.execute(
        sql`INSERT INTO material_upload_parts (upload_id,part,encrypted_content) VALUES (${id},${i},${legacy[i]}) ON CONFLICT DO NOTHING`,
      );
    const hash = createHash("sha256");
    let total = 0,
      index = 0;
    for (;;) {
      const parts = rows(
        await tx.execute(
          sql`SELECT part,encrypted_content FROM material_upload_parts WHERE upload_id=${id} AND part>=${index} ORDER BY part LIMIT 4`,
        ),
      );
      if (!parts.length) break;
      for (const part of parts) {
        assert(Number(part.part) === index, 400, "Brakuje części pliku.");
        const bytes = Buffer.from(
          decrypt(String(part.encrypted_content)),
          "base64",
        );
        assert(
          bytes.length === Math.min(CHUNK, Number(upload.size) - total),
          400,
          "Nieprawidłowy rozmiar części.",
        );
        if (index === 0)
          assert(
            bytes.subarray(0, 5).toString() === "%PDF-",
            400,
            "Nieprawidłowy plik PDF.",
          );
        hash.update(bytes);
        total += bytes.length;
        index++;
      }
    }
    assert(
      total === Number(upload.size) && hash.digest("hex") === upload.sha256,
      400,
      "Plik nie jest kompletny lub suma kontrolna jest niezgodna.",
    );
    const encryptedContent = encrypt(
      MATERIAL_CHUNKS + JSON.stringify({ uploadId: id, size: total }),
    );
    let materialId: string;
    if (upload.replaces_id) {
      const [item] = await tx
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.id, String(upload.replaces_id)),
            eq(materials.eventId, eventId),
          ),
        )
        .for("update");
      assert(
        item && digest(item.encryptedContent) === upload.expected_content_hash,
        409,
        "Materiał został zmieniony w innej karcie. Odśwież listę; dotychczasowy plik pozostaje bez zmian.",
      );
      materialId = item.id;
      await tx
        .update(materials)
        .set({
          encryptedContent,
          filename: String(upload.filename),
          mimeType: "application/pdf",
        })
        .where(eq(materials.id, item.id));
    } else {
      const [item] = await tx
        .insert(materials)
        .values({
          eventId,
          title: String(upload.filename)
            .replace(/\.pdf$/i, "")
            .slice(0, 160),
          filename: String(upload.filename),
          mimeType: "application/pdf",
          encryptedContent,
          published: true,
        })
        .returning({ id: materials.id });
      materialId = item.id;
    }
    await tx.execute(
      sql`UPDATE material_uploads SET material_id=${materialId},chunks='[]'::jsonb WHERE id=${id}`,
    );
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: upload.replaces_id ? "MATERIAL_UPDATED" : "MATERIAL_UPLOADED",
        targetId: materialId,
      });
    return { id: materialId, sha256: upload.sha256 };
  });
}
