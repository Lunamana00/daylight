import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { calendarSyncStatus, getGoogleSession, readCalendarGrant } from "../../lib/google-auth";
import { listGoogleCalendarChoices } from "../../lib/google-calendar";
import { PlannerError } from "../../lib/planner-core";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { DB: db, GOOGLE_CLIENT_SECRET: secret } = env;
  if (env.DAYLIGHT_AUTH_MODE !== "google" || !db || !secret) redirect("/");
  const requestHeaders = await headers();
  const session = await getGoogleSession(requestHeaders, env);
  if (!session) redirect("/");
  const connections = await calendarSyncStatus(env, session.user.userId) ?? [];
  const existing = new Map(connections.map(connection => [connection.calendarId, connection]));
  const previous = await db.prepare("SELECT calendar_id FROM calendar_sources WHERE owner_id=?")
    .bind(session.user.userId).all<{ calendar_id: string }>();
  const previousIds = new Set(previous.results.map(source => source.calendar_id));

  const grant = await readCalendarGrant(requestHeaders, session.sessionHash, secret);
  let choices: Awaited<ReturnType<typeof listGoogleCalendarChoices>> = [];
  let message = "";
  if (!grant) message = "캘린더 연결 시간이 지났어요. daylight에서 다시 시작해 주세요.";
  else {
    try { choices = await listGoogleCalendarChoices(grant.accessToken); }
    catch (error) { message = error instanceof PlannerError ? error.message : "Google 캘린더 목록을 읽지 못했어요."; }
    if (!message && choices.length === 0) message = "연결할 수 있는 캘린더가 없어요.";
  }
  const names = new Map<string, number>();
  for (const [, name] of choices) names.set(name, (names.get(name) ?? 0) + 1);

  return <main className="mx-auto flex max-w-lg flex-col gap-5">
    <a className="text-button self-start" href="/">← daylight</a>
    <h1>내 캘린더 선택</h1>
    {message ? <p role="status">{message}</p> : <form className="flex flex-col gap-4" method="post" action="/auth/google/calendar/sync">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3">내 일정에 표시할 캘린더 · 여러 개 선택 가능</legend>
        {choices.map(([id, name]) => {
          const connection = existing.get(id);
          return <label className="flex items-center gap-3" key={id}>
            <input type="checkbox" name="calendarId" value={id} defaultChecked={!!connection || previousIds.has(id)} />
            <span>{names.get(name) === 1 ? name : `${name} (${id})`}</span>
          </label>;
        })}
      </fieldset>
      <p className="tiny muted">본인에게만 보이며 5분마다 동기화됩니다. 최대 20개를 선택할 수 있어요. 선택을 해제해도 가져온 일정은 남습니다.</p>
      <button className="button primary self-start" type="submit">선택한 캘린더 자동 동기화</button>
    </form>}
  </main>;
}
