import { env } from "cloudflare:workers";
import { getDaylightSession } from "../../identity";
import { change, day, PlannerError, readDay, readCalendar, today, widgetPlan } from "../../../lib/planner-core";
import { calendarSyncStatus, syncSavedGoogleCalendars } from "../../../lib/google-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function fail(error: unknown) {
  if (error instanceof PlannerError) return Response.json({ error: error.message }, { status: error.status, headers });
  console.error("Planner request failed", error);
  return Response.json({ error: "저장소에 연결하지 못했어요. 잠시 후 다시 시도해주세요." }, { status: 500, headers });
}
export async function GET(request: Request) {
  try {
    const session = await getDaylightSession(request.headers, true);
    if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
    if (!env.DB) throw new Error("Missing DB");
    const date = session.client === "mac" ? today() : day(new URL(request.url).searchParams.get("date") || today());
    const view = new URL(request.url).searchParams.get("view");
    if (session.client !== "mac" && (view === "month" || view === "week")) {
      return Response.json(await readCalendar(env.DB, session.user, date, view), { headers });
    }
    const data = await readDay(env.DB, session.user, date, env.DAYLIGHT_AUTH_MODE === "google");
    data.calendarSync = await calendarSyncStatus(env, session.user.userId);
    return Response.json(session.client === "mac" ? widgetPlan(data) : data, { headers });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const session = await getDaylightSession(request.headers, true);
    const mac = session?.client === "mac";
    if (!mac && request.headers.get("origin") !== new URL(request.url).origin) {
      if (env.DAYLIGHT_AUTH_MODE === "google" && !session && request.headers.has("authorization")) {
        return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
      }
      throw new PlannerError("같은 사이트에서만 변경할 수 있어요.", 403);
    }
    if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
    const body = await request.text();
    if (body.length > 2_000_000) throw new PlannerError("요청 내용이 너무 큽니다.");
    let input;
    try { input = JSON.parse(body); } catch { throw new PlannerError("올바른 요청이 아닙니다."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError("올바른 요청이 아닙니다.");
    if (!env.DB) throw new Error("Missing DB");
    const date = day(input.viewDate || today());
    if (input.op === "calendar.sync" && env.DAYLIGHT_AUTH_MODE === "google") {
      if (Object.keys(input).some(key => !["op", "viewDate"].includes(key))) throw new PlannerError("올바른 동기화 요청이 아닙니다.");
      await syncSavedGoogleCalendars(env, session.user.userId);
      const data = await readDay(env.DB, session.user, mac ? today() : date, true);
      data.calendarSync = await calendarSyncStatus(env, session.user.userId);
      return Response.json(mac ? widgetPlan(data) : data, { headers });
    }
    if (env.DAYLIGHT_AUTH_MODE === "google" && input.op === "milestones.reorder") {
      throw new PlannerError("개인 일정은 Google Calendar에서 관리해 주세요.", 403);
    }
    if (mac && (!["task.patch", "subtask.patch"].includes(input.op) || typeof input.done !== "boolean"
        || Object.keys(input).some(key => !["op", "id", "done", "viewDate"].includes(key)))) {
      throw new PlannerError("위젯에서는 할 일 완료 상태만 변경할 수 있습니다.", 403);
    }
    if (mac && date !== today()) throw new PlannerError("위젯을 새로고침해 주세요.", 409);
    await change(env.DB, session.user, input, mac ? date : undefined);
    const data = await readDay(env.DB, session.user, date, env.DAYLIGHT_AUTH_MODE === "google");
    data.calendarSync = await calendarSyncStatus(env, session.user.userId);
    return Response.json(mac ? widgetPlan(data) : data, { headers });
  } catch (error) { return fail(error); }
}
