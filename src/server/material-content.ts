import "server-only";
import { sql } from "drizzle-orm";
import { db, type Database } from "@/db";
import { decrypt } from "./crypto";
import { pdfStream } from "./incremental-pdf";

export const MATERIAL_CHUNKS = "g2g:material-chunks:v1:";
export function materialContent(
  encryptedContent: string,
  database: Database = db(),
) {
  const content = decrypt(encryptedContent);
  if (!content.startsWith(MATERIAL_CHUNKS))
    return pdfStream([new Uint8Array(Buffer.from(content, "base64"))]);
  const manifest = JSON.parse(content.slice(MATERIAL_CHUNKS.length)) as {
    uploadId: string;
    size: number;
  };
  let index = 0,
    total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (total === manifest.size) {
        controller.close();
        return;
      }
      const result = await database.execute(
        sql`SELECT encrypted_content FROM material_upload_parts WHERE upload_id=${manifest.uploadId} AND part=${index}`,
      );
      const rows = (
        Array.isArray(result)
          ? result
          : (result as { rows: { encrypted_content: string }[] }).rows
      ) as { encrypted_content: string }[];
      if (!rows[0]) {
        controller.error(new Error("Incomplete stored material"));
        return;
      }
      const bytes = Buffer.from(decrypt(rows[0].encrypted_content), "base64");
      if (!bytes.length || total + bytes.length > manifest.size) {
        controller.error(new Error("Invalid stored material size"));
        return;
      }
      total += bytes.length;
      index++;
      controller.enqueue(new Uint8Array(bytes));
    },
  });
}
