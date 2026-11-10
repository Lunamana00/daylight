import { env } from "cloudflare:workers";
import { PlannerError } from "../../../../../lib/planner-core";
import { ownedWorkFile } from "../../../../../lib/work-files";
import { privateHeaders, workAccess, workFail } from "../../access";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, ownerId, connection } = await workAccess(request, true);
    const file = await ownedWorkFile(db, ownerId, (await context.params).id, connection);
    if (!env.BUCKET) throw new PlannerError("파일 저장소 연결이 필요해요.", 503);
    const object = await env.BUCKET.get(file.objectKey);
    if (!object) throw new PlannerError("파일을 찾을 수 없어요.", 404);
    const inline = file.contentType.startsWith("image/") && new URL(request.url).searchParams.get("preview") === "1";
    return new Response(object.body, { headers: { ...privateHeaders,
      "Content-Type": file.contentType, "Content-Length": String(object.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, "%27")}`,
    } });
  } catch (error) { return workFail(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, ownerId } = await workAccess(request);
    const file = await ownedWorkFile(db, ownerId, (await context.params).id);
    if (!env.BUCKET) throw new PlannerError("파일 저장소 연결이 필요해요.", 503);
    await env.BUCKET.delete(file.objectKey);
    await db.prepare("DELETE FROM work_files WHERE id=? AND owner_id=?").bind(file.id, ownerId).run();
    return Response.json({ deleted: true }, { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
