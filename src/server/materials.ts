import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { auditLogs, materials } from "@/db/schema";
import { assert } from "./errors";
import { decrypt, encrypt } from "./crypto";
import { presentParticipant } from "./attendance";
export async function uploadMaterial(
  eventId: string,
  adminId: string,
  file: File,
) {
  assert(
    file.size > 0 && file.size <= 2 * 1024 * 1024,
    400,
    "Maksymalny rozmiar materiału: 2 MB.",
  );
  assert(file.name.toLowerCase().endsWith(".pdf"), 400, "Wybierz plik PDF.");
  const content = Buffer.from(await file.arrayBuffer());
  assert(
    content.subarray(0, 5).toString() === "%PDF-",
    400,
    "Nieprawidłowy plik PDF.",
  );
  const title = file.name.replace(/\.pdf$/i, "").slice(0, 160);
  return db().transaction(async (tx) => {
    const [item] = await tx
      .insert(materials)
      .values({
        eventId,
        title,
        filename: "material.pdf",
        mimeType: "application/pdf",
        encryptedContent: encrypt(content.toString("base64")),
      })
      .returning({ id: materials.id });
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "MATERIAL_UPLOADED",
        targetId: item.id,
      });
    return item;
  });
}
export async function downloadMaterial(
  participantId: string,
  materialId: string,
  database: Database = db(),
) {
  const { person } = await presentParticipant(participantId, database);
  const [item] = await database
    .select()
    .from(materials)
    .where(
      and(eq(materials.id, materialId), eq(materials.eventId, person.eventId)),
    );
  assert(item, 404, "Nie znaleziono materiału.");
  return new Response(
    new Uint8Array(Buffer.from(decrypt(item.encryptedContent), "base64")),
    {
      headers: {
        "Content-Type": item.mimeType,
        "Content-Disposition": 'attachment; filename="material.pdf"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
