import { env } from "cloudflare:workers";
import { connectWorkGithub, disconnectWorkGithub, saveWorkGithub, workGithubState } from "../../../../lib/work-github";
import { PlannerError } from "../../../../lib/planner-core";
import { privateHeaders, workAccess, workBody, workFail } from "../access";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db, ownerId } = await workAccess(request);
    const artifactId = new URL(request.url).searchParams.get("artifactId") || "";
    return Response.json(await workGithubState(db, ownerId, artifactId), { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
export async function POST(request: Request) {
  try {
    const { db, ownerId } = await workAccess(request), input = await workBody(request);
    let result;
    if (input.op === "connect") result = await connectWorkGithub(db, ownerId, input, env.WORK_GITHUB_KEY);
    else if (input.op === "disconnect") result = await disconnectWorkGithub(db, ownerId, input.artifactId);
    else if (input.op === "save") result = await saveWorkGithub(db, ownerId, input.entryId, env.WORK_GITHUB_KEY, env.BUCKET);
    else throw new PlannerError("지원하지 않는 요청입니다.");
    return Response.json(result, { headers: privateHeaders });
  } catch (error) { return workFail(error); }
}
