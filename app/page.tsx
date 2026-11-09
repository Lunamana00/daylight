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
      return <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-xl font-semibold">daylight</h1>
        <a className="button primary" href="/auth/google/start">Google로 로그인</a>
      </main>;
    }
  } else {
    await requireChatGPTUser("/");
  }
  return <Planner googleLogin={googleLogin} />;
}
