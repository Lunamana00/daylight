import { env } from "cloudflare:workers";
import { PlannerError } from "../../../../lib/planner-core";
import { maxWorkFileSize, uploadWorkFile } from "../../../../lib/work-files";
import { privateHeaders, workAccess, workBytes, workFail } from "../access";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const { db, ownerId, connection } = await workAccess(request, true);
    if (!env.BUCKET) throw new PlannerError("파일 저장소 연결이 필요해요.", 503);
    const data = await workBytes(request, maxWorkFileSize + 16_384);
    let form: FormData;
    try { form = await new Response(data, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new PlannerError("파일 형식을 확인해 주세요."); }
    const file = form.get("file"), entryId = form.get("entryId");
    if (!(file instanceof File) || typeof entryId !== "string") throw new PlannerError("파일과 기록을 선택해 주세요.");
    return Response.json(await uploadWorkFile(db, env.BUCKET, ownerId, entryId, file.name, new Uint8Array(await file.arrayBuffer()), connection), { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
