import { addDays, day, PlannerError, syncMilestones, today } from "./planner-core";
import type { Identity } from "./planner-core";

export const calendarListScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const calendarEventsScope = "https://www.googleapis.com/auth/calendar.events.readonly";

type CalendarEntry = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  deleted?: boolean;
  accessRole?: string;
};
type CalendarEvent = {
  id?: string;
  summary?: string;
  status?: string;
  visibility?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
};
type CalendarPage<Item> = { items?: Item[]; nextPageToken?: string };

const readableRoles = new Set(["reader", "writerWithoutPrivateAccess", "writer", "owner"]);
const calendarFields = "id,summary,summaryOverride,primary,deleted,accessRole";

function calendarId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && /^[^\s/\\?#@]+@[^\s/\\?#@]+$/.test(value);
}

function choice(entry: CalendarEntry) {
  if (!calendarId(entry.id) || entry.deleted || !readableRoles.has(entry.accessRole ?? "")) return null;
  const name = (entry.summaryOverride || entry.summary || "").trim();
  return name ? { id: entry.id, name } : null;
}

async function googleCalendar<T>(path: string, accessToken: string, params: URLSearchParams) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
  url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new PlannerError("Google 캘린더를 읽을 수 없어요. 계정과 캘린더 읽기 권한을 확인해 주세요.", 502);
  return await response.json() as T;
}

export async function listGoogleCalendarChoices(accessToken: string) {
  const calendars = new Map<string, string>();
  const params = new URLSearchParams({ minAccessRole: "reader", maxResults: "250", fields: `nextPageToken,items(${calendarFields})` });
  for (let page = 0; page < 20; page++) {
    const result = await googleCalendar<CalendarPage<CalendarEntry>>("users/me/calendarList", accessToken, params);
    for (const entry of result.items ?? []) {
      const calendar = choice(entry);
      if (calendar) calendars.set(calendar.id, calendar.name);
    }
    if (!result.nextPageToken) return [...calendars].sort((a, b) => a[1].localeCompare(b[1], "ko"));
    params.set("pageToken", result.nextPageToken);
  }
  throw new PlannerError("Google 캘린더 목록을 끝까지 읽지 못했어요. 다시 시도해 주세요.", 502);
}

export async function selectGoogleCalendars(values: unknown[], accessToken: string) {
  if (!values.length || values.length > 20 || !values.every(calendarId) || new Set(values).size !== values.length) {
    throw new PlannerError("캘린더를 1개에서 20개까지 선택해 주세요.");
  }
  const choices = new Map(await listGoogleCalendarChoices(accessToken));
  if (values.some(id => !choices.has(id))) throw new PlannerError("선택한 캘린더를 읽을 수 없어요.");
  return values;
}

export async function syncGoogleCalendar(db: D1Database, user: Identity, id: string, accessToken: string) {
  const from = today(), to = addDays(from, 90);
  const params = new URLSearchParams({
    timeMin: `${from}T00:00:00+09:00`, timeMax: `${addDays(to, 1)}T00:00:00+09:00`, timeZone: "Asia/Seoul",
    singleEvents: "true", eventTypes: "default", maxResults: "500",
    fields: "nextPageToken,summary,accessRole,items(id,summary,status,visibility,htmlLink,start(date,dateTime))",
  });
  const events: Array<{ eventId: string; title: string; date: string; url?: string }> = [];
  for (let page = 0; page < 20; page++) {
    const result = await googleCalendar<CalendarPage<CalendarEvent> & { summary?: string; accessRole?: string }>(
      `calendars/${encodeURIComponent(id)}/events`, accessToken, params,
    );
    if (!readableRoles.has(result.accessRole ?? "")) throw new PlannerError("일정 제목을 읽을 수 있는 캘린더 권한이 필요해요.", 403);
    for (const event of result.items ?? []) {
      if (event.status === "cancelled") continue;
      const title = event.summary?.trim();
      if (!title) continue;
      if (!event.id || !event.start || (!event.start.date && !event.start.dateTime)) {
        throw new PlannerError("Google에서 일정 정보를 끝까지 읽지 못했어요. 다시 시도해 주세요.", 502);
      }
      const date = day(event.start.date ?? today(new Date(event.start.dateTime!)));
      if (date < from || date > to) continue;
      events.push({ eventId: event.id, title: title.slice(0, 240), date, url: event.htmlLink });
      if (events.length > 500) throw new PlannerError("앞으로 90일의 일정이 500개를 넘어서 동기화할 수 없어요.");
    }
    if (!result.nextPageToken) {
      const name = (result.summary?.trim() || "내 캘린더").slice(0, 120);
      await syncMilestones(db, user, { calendarId: id, name, from, to, events }, true);
      return;
    }
    params.set("pageToken", result.nextPageToken);
  }
  throw new PlannerError("Google 일정을 끝까지 읽지 못했어요. 다시 시도해 주세요.", 502);
}
