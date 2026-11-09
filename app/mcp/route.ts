import { env } from "cloudflare:workers";
import { getDaylightSession } from "../identity";
import { day, listMilestones, PlannerError, readDay, syncMilestones, today } from "../../lib/planner-core";

export const dynamic = "force-dynamic";
const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const tools = [
  { name: "get_daily_plan", description: "Read team members' manually written daily tasks, completion states, daily focus notes, and upcoming shared milestones. Dates use Asia/Seoul. Never infer that a milestone is a daily task. This tool cannot change daily tasks.", inputSchema: { type: "object", properties: { date: dateSchema }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "list_milestones", description: "Read shared Google Calendar milestone snapshots. syncedAt shows freshness; these are not live Google reads. Never describe a failed or old sync as current.", inputSchema: { type: "object", required: ["from", "to"], properties: { from: dateSchema, to: dateSchema }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "sync_google_calendar_milestones", description: "After the user explicitly selects a Google Calendar to share with this team, read its actual events using the connected Google Calendar plugin and call this tool with a COMPLETE snapshot for the inclusive date window (maximum 100 days, 500 events). Finish all Google pagination and recurring-event expansion first; never call after a partial or failed fetch. Use original event IDs, titles and links. For all-day events use start.date; for timed events use the start date in Asia/Seoul. This replaces this shared calendar in that window, removing missing events; the same calendar is shared across members without duplicates. Every member of this Site can see imported milestones. Daily tasks are never changed. Do not import a private calendar without permission.", inputSchema: { type: "object", required: ["calendarId", "name", "from", "to", "events"], properties: { calendarId: { type: "string", minLength: 1, maxLength: 300 }, name: { type: "string", minLength: 1, maxLength: 120 }, from: dateSchema, to: dateSchema, events: { type: "array", maxItems: 500, items: { type: "object", required: ["eventId", "title", "date"], properties: { eventId: { type: "string", maxLength: 1024 }, title: { type: "string", maxLength: 240 }, date: dateSchema, url: { type: "string" } }, additionalProperties: false } } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const calendarSync = env.DAYLIGHT_AUTH_MODE !== "google";
  let id: unknown = null;
  try {
    const origin = request.headers.get("origin");
    if ((origin || env.DAYLIGHT_AUTH_MODE === "google") && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403, headers });
    const session = await getDaylightSession(request.headers);
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401, headers });
    const { user } = session;
    const raw = await request.text();
    if (raw.length > 512_000) return Response.json({ error: "Request too large" }, { status: 413, headers });
    let rpc;
    try { rpc = JSON.parse(raw); } catch { return Response.json({ jsonrpc: "2.0", id, error: { code: -32700, message: "Invalid JSON" } }, { headers }); }
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || (rpc.id !== undefined && typeof rpc.id !== "string" && typeof rpc.id !== "number" && rpc.id !== null)) return Response.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }, { headers });
    id = rpc.id ?? null;
    if (rpc.method.startsWith("notifications/")) return new Response(null, { status: 202, headers });
    let result: unknown;
    if (rpc.method === "server/discover") result = { supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, serverInfo: { name: "daylight", version: "1.0.0" } };
    else if (rpc.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "daylight", version: "1.0.0" } };
    else if (rpc.method === "ping") result = {};
    else if (rpc.method === "tools/list") result = { tools: calendarSync ? tools : tools.filter(tool => tool.name !== "sync_google_calendar_milestones").map(tool => ({ ...tool, description: tool.name === "get_daily_plan" ? "Read each person's daily tasks and completion state, plus the signed-in person's private calendar events. Calendar events are separate from daily tasks." : "Read only the signed-in person's saved Google Calendar events. syncedAt shows when these events were last imported." })) };
    else if (rpc.method === "tools/call") {
      const args = rpc.params?.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new PlannerError("Invalid arguments");
      if (!env.DB) throw new Error("Missing DB");
      let value;
      if (rpc.params?.name === "get_daily_plan") value = await readDay(env.DB, user, day(args.date ?? today()), !calendarSync);
      else if (rpc.params?.name === "list_milestones") value = await listMilestones(env.DB, day(args.from), day(args.to), calendarSync ? undefined : user.userId);
      else if (calendarSync && rpc.params?.name === "sync_google_calendar_milestones") value = await syncMilestones(env.DB, user, args);
      else return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } }, { headers });
      result = { content: [{ type: "text", text: JSON.stringify(value) }] };
    } else return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, { headers });
    return Response.json({ jsonrpc: "2.0", id, result }, { headers });
  } catch (error) {
    if (!(error instanceof PlannerError)) console.error("MCP operation failed", error);
    return Response.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error instanceof PlannerError ? error.message : "저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." }] } }, { headers });
  }
}
