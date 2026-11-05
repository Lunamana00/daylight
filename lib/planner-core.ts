// Site-admitted members share reads; writes always use the authenticated owner.
export type Identity = { userId: string; email: string; fullName?: string | null };
export type Member = { id: string; name: string };
export type Task = { id: string; ownerId: string; date: string; title: string; done: number; important: number; createdAt: string; updatedAt: string; ownerName: string };
export type Note = { ownerId: string; date: string; content: string; updatedAt: string; ownerName: string };
export type Milestone = { ownerId: string; calendarId: string; eventId: string; title: string; date: string; url: string | null; ownerName: string; sourceName: string; syncedAt: string };
export type Source = { ownerId: string; calendarId: string; name: string; syncedAt: string; ownerName: string };
export type DayData = { date: string; me: Member; members: Member[]; tasks: Task[]; notes: Note[]; milestones: Milestone[]; sources: Source[] };

export class PlannerError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value || value < "2000-01-01" || value > "2100-12-31") throw new PlannerError("올바른 날짜를 선택해주세요.");
  return value;
}
export function addDays(value: string, amount: number) {
  const result = new Date(day(value) + "T00:00:00Z");
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.trim().length > max) throw new PlannerError(`${label}을(를) ${empty ? "0" : "1"}~${max}자로 입력해주세요.`);
  return value.trim();
}
function bool(value: unknown): number {
  if (typeof value !== "boolean") throw new PlannerError("잘못된 변경 요청입니다.");
  return value ? 1 : 0;
}
export async function ensureMember(db: D1Database, user: Identity) {
  await db.prepare("INSERT INTO members (id,name,email,joined_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email")
    .bind(user.userId, (user.fullName || user.email.split("@")[0]).slice(0, 40), user.email, new Date().toISOString()).run();
}
export async function listMilestones(db: D1Database, from: string, to: string) {
  day(from); day(to);
  if (to < from || to > addDays(from, 366)) throw new PlannerError("마일스톤 조회 기간은 1년 이내로 선택해주세요.");
  const result = await db.prepare("SELECT m.owner_id AS ownerId,m.calendar_id AS calendarId,m.event_id AS eventId,m.title,m.date,m.url,m.synced_at AS syncedAt,p.name AS ownerName,s.name AS sourceName FROM milestones m JOIN members p ON p.id=m.owner_id JOIN calendar_sources s ON s.calendar_id=m.calendar_id WHERE m.date>=? AND m.date<=? ORDER BY m.date,m.title LIMIT 1000").bind(from, to).all<Milestone>();
  return result.results;
}
export async function readDay(db: D1Database, user: Identity, date: string): Promise<DayData> {
  day(date);
  await ensureMember(db, user);
  const [people, tasks, notes, milestones, sources] = await Promise.all([
    db.prepare("SELECT id,name FROM members ORDER BY joined_at,id").all<Member>(),
    db.prepare("SELECT t.id,t.owner_id AS ownerId,t.date,t.title,t.done,t.important,t.created_at AS createdAt,t.updated_at AS updatedAt,p.name AS ownerName FROM tasks t JOIN members p ON p.id=t.owner_id WHERE t.date=? ORDER BY t.done,t.important DESC,t.created_at,t.id").bind(date).all<Task>(),
    db.prepare("SELECT n.owner_id AS ownerId,n.date,n.content,n.updated_at AS updatedAt,p.name AS ownerName FROM notes n JOIN members p ON p.id=n.owner_id WHERE n.date=?").bind(date).all<Note>(),
    listMilestones(db, date, addDays(date, 90) > "2100-12-31" ? "2100-12-31" : addDays(date, 90)),
    db.prepare("SELECT s.owner_id AS ownerId,s.calendar_id AS calendarId,s.name,s.synced_at AS syncedAt,p.name AS ownerName FROM calendar_sources s JOIN members p ON p.id=s.owner_id ORDER BY s.synced_at DESC").all<Source>(),
  ]);
  return { date, me: people.results.find(p => p.id === user.userId)!, members: people.results, tasks: tasks.results, notes: notes.results, milestones, sources: sources.results };
}
export async function change(db: D1Database, user: Identity, input: Record<string, unknown>) {
  await ensureMember(db, user);
  const now = new Date().toISOString();
  if (input.op === "task.add") {
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO tasks (id,owner_id,date,title,done,important,created_at,updated_at) VALUES (?,?,?,?,0,?,?,?)").bind(id, user.userId, day(input.date), text(input.title, "할 일", 240), input.important === undefined ? 0 : bool(input.important), now, now).run();
    return { id };
  }
  if (input.op === "task.patch" || input.op === "task.delete") {
    const id = text(input.id, "할 일 ID", 100);
    if (input.op === "task.delete") {
      const result = await db.prepare("DELETE FROM tasks WHERE id=? AND owner_id=?").bind(id, user.userId).run();
      if (!result.meta.changes) throw new PlannerError("본인의 할 일만 삭제할 수 있어요. 이미 삭제되었을 수도 있습니다.", 403);
      return { id };
    }
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (input.title !== undefined) { fields.push("title=?"); values.push(text(input.title, "할 일", 240)); }
    if (input.date !== undefined) { fields.push("date=?"); values.push(day(input.date)); }
    if (input.done !== undefined) { fields.push("done=?"); values.push(bool(input.done)); }
    if (input.important !== undefined) { fields.push("important=?"); values.push(bool(input.important)); }
    if (!fields.length) throw new PlannerError("변경할 내용을 입력해주세요.");
    const result = await db.prepare(`UPDATE tasks SET ${fields.join(",")},updated_at=? WHERE id=? AND owner_id=?`).bind(...values, now, id, user.userId).run();
    if (!result.meta.changes) throw new PlannerError("본인의 할 일만 수정할 수 있어요. 이미 삭제되었을 수도 있습니다.", 403);
    return { id };
  }
  if (input.op === "note.save") {
    await db.prepare("INSERT INTO notes (owner_id,date,content,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at").bind(user.userId, day(input.date), text(input.content, "오늘의 한 줄", 500, true), now).run();
    return { saved: true };
  }
  if (input.op === "profile.save") {
    await db.prepare("UPDATE members SET name=? WHERE id=?").bind(text(input.name, "이름", 40), user.userId).run();
    return { saved: true };
  }
  throw new PlannerError("지원하지 않는 요청입니다.");
}
export async function syncMilestones(db: D1Database, user: Identity, input: Record<string, unknown>) {
  const calendarId = text(input.calendarId, "캘린더 ID", 300);
  const name = text(input.name, "캘린더 이름", 120);
  const from = day(input.from), to = day(input.to);
  if (to < from || to > addDays(from, 100)) throw new PlannerError("한 번에 100일 이내의 일정만 동기화할 수 있어요.");
  if (!Array.isArray(input.events) || input.events.length > 500) throw new PlannerError("일정은 최대 500개까지 동기화할 수 있어요.");
  const seen = new Set<string>();
  const events = input.events.map((event: unknown) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new PlannerError("올바른 일정이 아닙니다.");
    const item = event as Record<string, unknown>;
    const eventId = text(item.eventId, "일정 ID", 1024);
    const date = day(item.date);
    if (date < from || date > to || seen.has(eventId)) throw new PlannerError("중복 일정이 있거나 동기화 기간에 맞지 않습니다.");
    seen.add(eventId);
    let url: string | null = null;
    if (item.url) {
      try { const parsed = new URL(text(item.url, "일정 주소", 4096)); if (parsed.protocol !== "https:" || !["calendar.google.com", "www.google.com"].includes(parsed.hostname)) throw new Error(); url = parsed.href; }
      catch { throw new PlannerError("Google 캘린더 일정 주소만 사용할 수 있어요."); }
    }
    return { eventId, date, title: text(item.title, "마일스톤", 240), url };
  });
  await ensureMember(db, user);
  const now = new Date().toISOString();
  // D1 batch is atomic: failed insertion never erases the previous snapshot.
  await db.batch([
    db.prepare("INSERT INTO calendar_sources (owner_id,calendar_id,name,synced_at) VALUES (?,?,?,?) ON CONFLICT(calendar_id) DO UPDATE SET owner_id=excluded.owner_id,name=excluded.name,synced_at=excluded.synced_at").bind(user.userId, calendarId, name, now),
    db.prepare("DELETE FROM milestones WHERE calendar_id=? AND date>=? AND date<=?").bind(calendarId, from, to),
    ...events.map(event => db.prepare("INSERT INTO milestones (owner_id,calendar_id,event_id,title,date,url,synced_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(calendar_id,event_id) DO UPDATE SET owner_id=excluded.owner_id,title=excluded.title,date=excluded.date,url=excluded.url,synced_at=excluded.synced_at").bind(user.userId, calendarId, event.eventId, event.title, event.date, event.url, now)),
  ]);
  return { count: events.length, from, to, syncedAt: now, message: "팀 공통 마일스톤을 갱신했습니다. 일일 할 일은 변경하지 않았습니다." };
}
