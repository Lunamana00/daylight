import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { requireChatGPTUser } from "./chatgpt-auth";
import { getDaylightSession } from "./identity";
import Planner from "./planner";

export const dynamic = "force-dynamic";
export default async function Home() {
  const googleLogin = env.DAYLIGHT_AUTH_MODE === "google";
  if (googleLogin) {
    if (!await getDaylightSession(await headers())) {
      return <main className="welcome-page">
        <header className="welcome-brand"><img src="/favicon.svg" width="28" height="28" alt="" /><h1>daylight</h1></header>
        <p>할 일, 개인 일정, 프로젝트 기록을 한곳에서 정리합니다.</p>
        <ul>
          <li>직접 정한 할 일과 하위 항목을 기록합니다.</li>
          <li>선택한 Google 캘린더를 읽어 내 일정과 Mac 위젯에 표시합니다.</li>
          <li>함께 초대된 사람들과 할 일과 완료 상태를 공유합니다. 개인 캘린더와 작업물 기록은 본인 화면에만 표시됩니다.</li>
        </ul>
        <a className="button primary" href="/auth/google/start">초대받은 Google 계정으로 로그인</a>
        <footer><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a></footer>
      </main>;
    }
  } else {
    await requireChatGPTUser("/");
  }
  return <Planner googleLogin={googleLogin} />;
}
