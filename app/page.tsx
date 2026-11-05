import { requireChatGPTUser } from "./chatgpt-auth";
import Planner from "./planner";

export const dynamic = "force-dynamic";
export default async function Home() {
  await requireChatGPTUser("/");
  return <Planner />;
}
