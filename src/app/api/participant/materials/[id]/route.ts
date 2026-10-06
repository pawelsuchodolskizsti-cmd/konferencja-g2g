import { z } from "zod";
import { requireParticipant } from "@/server/auth";
import { downloadMaterial } from "@/server/materials";
import { apiError } from "@/server/http";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const person = await requireParticipant();
    return await downloadMaterial(person.id, z.uuid().parse((await params).id));
  } catch (error) {
    return apiError(error);
  }
}
