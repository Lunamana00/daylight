import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { change, day, PlannerError, readDay, today } from "../../../lib/planner-core";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function fail(error: unknown) {
  if (error instanceof PlannerError) return Response.json({ error: error.message }, { status: error.status, headers });
  console.error("Planner request failed", error);
  return Response.json({ error: "저장소에 연결하지 못했어요. 잠시 후 다시 시도해주세요." }, { status: 500, headers });
}
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
    if (!env.DB) throw new Error("Missing DB");
    return Response.json(await readDay(env.DB, user, day(new URL(request.url).searchParams.get("date") || today())), { headers });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new PlannerError("같은 사이트에서만 변경할 수 있어요.", 403);
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
    const body = await request.text();
    if (body.length > 16_384) throw new PlannerError("요청 내용이 너무 큽니다.");
    let input;
    try { input = JSON.parse(body); } catch { throw new PlannerError("올바른 요청이 아닙니다."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError("올바른 요청이 아닙니다.");
    if (!env.DB) throw new Error("Missing DB");
    const date = day(input.viewDate || today());
    await change(env.DB, user, input);
    return Response.json(await readDay(env.DB, user, date), { headers });
  } catch (error) { return fail(error); }
}
