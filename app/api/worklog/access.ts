import { env } from "cloudflare:workers";
import { getDaylightSession } from "../../identity";
import { PlannerError } from "../../../lib/planner-core";
import { workObject } from "../../../lib/work-log";

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function workAccess(request: Request, allowCollector = false) {
  if (!env.DB) throw new Error("Missing DB");
  if (allowCollector && request.headers.has("authorization")) {
    throw new PlannerError("자동 수집은 보류 중입니다. daylight에서 직접 자료를 추가해 주세요.", 410);
  }
  const session = await getDaylightSession(request.headers);
  if (!session) throw new PlannerError("로그인이 필요합니다.", 401);
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) throw new PlannerError("같은 사이트에서만 변경할 수 있어요.", 403);
  return { db: env.DB, ownerId: session.user.userId, connection: null, user: session.user };
}
export async function workBody(request: Request) {
  const body = new TextDecoder().decode(await workBytes(request, 600_000));
  try { return workObject(JSON.parse(body)); }
  catch (error) { if (error instanceof PlannerError) throw error; throw new PlannerError("기록 형식을 확인해 주세요."); }
}
export async function workBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new PlannerError("요청 내용이 너무 큽니다.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new PlannerError("요청 내용이 너무 큽니다.", 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
export function workFail(error: unknown) {
  if (error instanceof PlannerError) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  console.error("Work log request failed", error);
  return Response.json({ error: "작업 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500, headers: privateHeaders });
}
