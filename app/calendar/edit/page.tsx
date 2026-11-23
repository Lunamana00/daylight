import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getGoogleSession } from "../../../lib/google-auth";

export const dynamic = "force-dynamic";

export default async function CalendarEditPage() {
  if (env.DAYLIGHT_AUTH_MODE !== "google" || !await getGoogleSession(await headers(), env)) redirect("/");
  return <main className="mx-auto flex max-w-lg flex-col gap-5">
    <a className="text-button self-start" href="/">← Dailog</a>
    <h1>달력에서 일정 옮기기</h1>
    <p>Mac 달력에서 일정을 드래그하면 Google Calendar의 날짜와 시간이 함께 바뀝니다. 연결할 캘린더는 직접 선택할 수 있어요.</p>
    <p>반복 일정은 옮긴 날짜의 일정 하나만 변경합니다. 참석자가 있는 일정은 Google에서 변경 알림을 보냅니다.</p>
    <form method="post" action="/auth/google/calendar">
      <input type="hidden" name="edit" value="true" />
      <button className="button primary" type="submit">Google 일정 이동 허용</button>
    </form>
    <a className="text-button" href="/privacy">Google 정보 이용 안내</a>
  </main>;
}
