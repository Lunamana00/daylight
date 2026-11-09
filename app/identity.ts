import { env } from "cloudflare:workers";
import { getGoogleSession } from "../lib/google-auth";
import { getChatGPTUser } from "./chatgpt-auth";

export async function getDaylightSession(headers: Pick<Headers, "get">, allowMac = false) {
  if (env.DAYLIGHT_AUTH_MODE === "google") return getGoogleSession(headers, env, allowMac);
  const user = await getChatGPTUser();
  return user && { user, client: "site" as const };
}
