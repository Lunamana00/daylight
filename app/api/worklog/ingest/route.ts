import { privateHeaders } from "../access";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ error: "자동 수집은 보류 중입니다. daylight에서 직접 기록을 추가해 주세요." }, { status: 410, headers: privateHeaders });
}
export const POST = GET;
