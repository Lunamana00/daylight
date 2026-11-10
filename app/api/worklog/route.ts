import { changeWork, ownedArtifact, readWorkCatalog, readWorkDetail } from "../../../lib/work-log";
import { workMarkdown } from "../../../lib/work-log-types";
import { PlannerError } from "../../../lib/planner-core";
import { privateHeaders, workAccess, workBody, workFail } from "./access";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db, ownerId, user } = await workAccess(request), params = new URL(request.url).searchParams;
    if (!params.has("artifactId")) return Response.json({ ...await readWorkCatalog(db, user!), uploadsAvailable: true }, { headers: privateHeaders });
    const artifactId = params.get("artifactId") || null;
    const detail = await readWorkDetail(db, ownerId, artifactId, params.has("export") ? null : params.get("cursor"), params.has("export") ? null : params.get("stageId"), params.has("export") ? 5000 : 100);
    if (params.has("export") && artifactId) {
      if (detail.nextCursor) throw new PlannerError("한 번에 기록 5,000개까지 내보낼 수 있어요.", 413);
      const artifact = await ownedArtifact(db, ownerId, artifactId);
      return new Response(workMarkdown(artifact, detail.entries, detail.stages, new URL(request.url).origin, params.get("export") === "portfolio"), { headers: { ...privateHeaders, "Content-Type": "text/markdown; charset=utf-8" } });
    }
    return Response.json(detail, { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
export async function POST(request: Request) {
  try {
    const { db, user } = await workAccess(request);
    return Response.json(await changeWork(db, user!, await workBody(request)), { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
