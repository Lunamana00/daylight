import { addDays, day, PlannerError, syncMilestones, today, weekRange } from "./planner-core";
import type { Identity } from "./planner-core";

export const calendarListScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const calendarEventsScope = "https://www.googleapis.com/auth/calendar.events.readonly";
export const calendarEditScope = "https://www.googleapis.com/auth/calendar.events";

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
  etag?: string;
  recurrence?: string[];
  summary?: string;
  status?: string;
  visibility?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};
type CalendarPage<Item> = { items?: Item[]; nextPageToken?: string };

const readableRoles = new Set(["reader", "writerWithoutPrivateAccess", "writer", "owner"]);
const writableRoles = new Set(["writerWithoutPrivateAccess", "writer", "owner"]);
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
  const from = weekRange(today()).from, to = addDays(today(), 90);
  const params = new URLSearchParams({
    timeMin: `${from}T00:00:00+09:00`, timeMax: `${addDays(to, 1)}T00:00:00+09:00`, timeZone: "Asia/Seoul",
    singleEvents: "true", eventTypes: "default", maxResults: "500",
    fields: "nextPageToken,summary,accessRole,items(id,summary,status,visibility,htmlLink,start(date,dateTime),end(date,dateTime))",
  });
  const events: Array<{ eventId: string; title: string; date: string; endDate: string; startAt?: string; endAt?: string; url?: string }> = [];
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
      // Google end dates are exclusive, including midnight ends of timed events.
      const endDate = event.end?.date ? addDays(day(event.end.date), -1)
        : event.end?.dateTime ? day(today(new Date(Date.parse(event.end.dateTime) - 1))) : date;
      if (endDate < from || date > to) continue;
      events.push({ eventId: event.id, title: title.slice(0, 240), date, endDate,
        startAt: event.start.dateTime, endAt: event.end?.dateTime, url: event.htmlLink });
      if (events.length > 500) throw new PlannerError("앞으로 90일의 일정이 500개를 넘어서 동기화할 수 없어요.");
    }
    if (!result.nextPageToken) {
      const name = (result.summary?.trim() || "내 캘린더").slice(0, 120);
      await syncMilestones(db, user, { calendarId: id, name, from, to, events }, true);
      return writableRoles.has(result.accessRole ?? "");
    }
    params.set("pageToken", result.nextPageToken);
  }
  throw new PlannerError("Google 일정을 끝까지 읽지 못했어요. 다시 시도해 주세요.", 502);
}

export type CalendarMove = { calendarId: string; eventId: string; start: string; end: string; newStart: string };

function eventInstant(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new PlannerError("일정의 시간이 올바르지 않아요.");
  }
  day(value.slice(0, 10));
  return new Date(value).toISOString();
}

export function calendarMove(input: Record<string, unknown>): CalendarMove {
  if (Object.keys(input).some(key => !["op", "calendarId", "eventId", "start", "end", "newStart", "viewDate"].includes(key))
      || !calendarId(input.calendarId) || typeof input.eventId !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(input.eventId)) {
    throw new PlannerError("올바른 일정 이동 요청이 아니에요.");
  }
  const allDay = typeof input.start === "string" && input.start.length === 10;
  const parse = allDay ? day : eventInstant;
  const start = parse(input.start), end = parse(input.end), newStart = parse(input.newStart);
  if (Date.parse(end) <= Date.parse(start)) throw new PlannerError("일정의 종료 시간을 확인해 주세요.");
  const date = allDay ? newStart : today(new Date(newStart));
  if (date < weekRange(today()).from || date > addDays(today(), 90)) throw new PlannerError("이번 주부터 90일 이내로 옮길 수 있어요.");
  return { calendarId: input.calendarId, eventId: input.eventId, start, end, newStart };
}

export async function moveGoogleCalendarEvent(db: D1Database, user: Identity, move: CalendarMove, accessToken: string) {
  const path = `calendars/${encodeURIComponent(move.calendarId)}/events/${encodeURIComponent(move.eventId)}`;
  const event = await googleCalendar<CalendarEvent>(path, accessToken, new URLSearchParams());
  const allDay = move.start.length === 10;
  const parse = allDay ? day : eventInstant;
  if (event.status === "cancelled" || event.recurrence || !event.etag
      || parse(allDay ? event.start?.date : event.start?.dateTime) !== move.start
      || parse(allDay ? event.end?.date : event.end?.dateTime) !== move.end) {
    throw new PlannerError("Google에서 일정이 바뀌었어요. 새로고침 후 다시 옮겨 주세요.", 409);
  }
  const finish = new Date(Date.parse(move.newStart) + Date.parse(move.end) - Date.parse(move.start)).toISOString();
  const newEnd = allDay ? day(finish.slice(0, 10)) : finish;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}?sendUpdates=all`, {
    method: "PATCH", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "If-Match": event.etag },
    // Patch only this instance's dates; preserve attendees, recurrence, links and descriptions.
    body: JSON.stringify(allDay ? { start: { date: move.newStart }, end: { date: newEnd } } : {
      start: { dateTime: move.newStart, ...(event.start?.timeZone ? { timeZone: event.start.timeZone } : {}) },
      end: { dateTime: newEnd, ...(event.end?.timeZone ? { timeZone: event.end.timeZone } : {}) },
    }),
  });
  if ([404, 410, 412].includes(response.status)) throw new PlannerError("Google에서 일정이 바뀌었어요. 새로고침 후 다시 옮겨 주세요.", 409);
  if (response.status === 403) throw new PlannerError("이 캘린더에서 일정을 수정할 권한이 없어요.", 403);
  if (!response.ok) throw new PlannerError("Google 일정 이동 결과를 확인하지 못했어요. 새로고침해 주세요.", 502);
  const date = allDay ? move.newStart : today(new Date(move.newStart));
  const endDate = allDay ? addDays(newEnd, -1) : today(new Date(Date.parse(newEnd) - 1));
  await db.prepare("UPDATE milestones SET date=?,end_date=?,start_at=?,end_at=?,synced_at=? WHERE owner_id=? AND calendar_id=? AND event_id=?")
    .bind(date, endDate, allDay ? null : move.newStart, allDay ? null : newEnd, new Date().toISOString(), user.userId, move.calendarId, move.eventId).run();
}
