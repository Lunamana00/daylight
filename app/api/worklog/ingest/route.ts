import { ownedArtifact, readWorkDetail, ingestWork } from "../../../../lib/work-log";
import { PlannerError } from "../../../../lib/planner-core";
import { privateHeaders, workAccess, workBody, workFail } from "../access";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db, ownerId, connection } = await workAccess(request, true);
    if (!connection) throw new PlannerError("수집 연결이 필요해요.", 401);
    const artifact = await ownedArtifact(db, ownerId, connection.artifactId);
    const detail = await readWorkDetail(db, ownerId, artifact.id);
    const known = (await db.prepare("SELECT source_key AS sourceKey,id,hidden FROM work_entries WHERE owner_id=? AND provider=? AND scope=? ORDER BY created_at DESC LIMIT 1000").bind(ownerId, connection.provider, connection.scope).all()).results;
    return Response.json({ artifact, stages: detail.stages, tasks: detail.tasks, source: { provider: connection.provider, scope: connection.scope, lastSyncAt: connection.lastSyncAt }, known, knownLimit: 1000 }, { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
export async function POST(request: Request) {
  try {
    const { db, connection } = await workAccess(request, true);
    if (!connection) throw new PlannerError("수집 연결이 필요해요.", 401);
    return Response.json(await ingestWork(db, connection, await workBody(request)), { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
