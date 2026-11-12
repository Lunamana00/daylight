// Site-admitted members share reads; writes always use the authenticated owner.
export type Identity = { userId: string; email: string; fullName?: string | null };
export type Member = { id: string; name: string };
export type Subtask = { id: string; taskId: string; date: string | null; title: string; done: number; sortOrder: number };
export type Task = { id: string; ownerId: string; date: string; endDate: string | null; title: string; done: number; important: number; sortOrder: number; createdAt: string; updatedAt: string; ownerName: string; subtasks: Subtask[]; unscheduledCount?: number; projectId?: string | null; projectTitle?: string | null; projectHue?: number | null };
export type BacklogItem = { id: string; title: string; taskId: string | null; taskTitle: string | null; taskDate: string | null; taskEndDate: string | null; projectId: string | null; projectTitle: string | null; projectHue: number | null; subtask?: number; done?: number };
export type TaskProject = { id: string; title: string };
export type Note = { ownerId: string; date: string; content: string; updatedAt: string; ownerName: string };
export type Milestone = { ownerId: string; calendarId: string; eventId: string; title: string; date: string; url: string | null; ownerName: string; sourceName: string; syncedAt: string };
export type Source = { ownerId: string; calendarId: string; name: string; syncedAt: string; ownerName: string };
export type DayData = { date: string; me: Member; members: Member[]; tasks: Task[]; projects?: TaskProject[]; notes: Note[]; milestones: Milestone[]; sources: Source[]; calendarSync?: Array<{ calendarId: string; enabled: boolean; canManage: boolean; error: string | null }> };
export type CalendarData = { from: string; to: string; tasks: Task[]; milestones: Milestone[] };
export const milestoneKey = (item: { calendarId: string; eventId: string }) => JSON.stringify([item.calendarId, item.eventId]);

export class PlannerError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const seoulDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
export function today(date = new Date()) {
  return seoulDay.format(date);
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
async function readTasks(db: D1Database, from: string, to: string, ownerId: string | null = null, projectOwnerId = ownerId): Promise<Task[]> {
  const where = "t.date<=? AND COALESCE(t.end_date,t.date)>=? AND (? IS NULL OR t.owner_id=?)";
  const [tasks, children] = await Promise.all([
    db.prepare(`SELECT t.id,t.owner_id AS ownerId,t.date,t.end_date AS endDate,t.title,t.done,t.important,t.sort_order AS sortOrder,t.created_at AS createdAt,t.updated_at AS updatedAt,p.name AS ownerName,a.id AS projectId,a.title AS projectTitle,a.color_hue AS projectHue,((SELECT count(*) FROM task_backlog b WHERE b.task_id=t.id) + CASE WHEN t.owner_id=? THEN 0 ELSE (SELECT count(*) FROM task_subtasks s WHERE s.task_id=t.id AND s.scheduled=0) END) AS unscheduledCount FROM tasks t JOIN members p ON p.id=t.owner_id LEFT JOIN work_task_links l ON l.task_id=t.id LEFT JOIN work_artifacts a ON a.id=l.artifact_id AND a.owner_id=t.owner_id AND a.owner_id=? WHERE ${where} ORDER BY t.sort_order,t.created_at,t.rowid`).bind(projectOwnerId, projectOwnerId, to, from, ownerId, ownerId).all<Task>(),
    db.prepare(`SELECT s.id,s.task_id AS taskId,CASE WHEN s.scheduled=1 THEN s.date ELSE NULL END AS date,s.title,s.done,s.sort_order AS sortOrder FROM task_subtasks s JOIN tasks t ON t.id=s.task_id WHERE ${where} AND (s.scheduled=1 OR t.owner_id=?) ORDER BY s.done,s.sort_order,s.created_at,s.rowid`).bind(to, from, ownerId, ownerId, projectOwnerId).all<Subtask>(),
  ]);
  const grouped = new Map<string, Subtask[]>();
  for (const child of children.results) {
    const list = grouped.get(child.taskId) ?? [];
    list.push(child); grouped.set(child.taskId, list);
  }
  return tasks.results.map(task => {
    const subtasks = grouped.get(task.id) ?? [];
    return { ...task, subtasks, done: task.unscheduledCount ? 0 : subtasks.length ? Number(subtasks.every(child => child.done)) : task.done };
  }).sort((a, b) => a.done - b.done);
}
export async function readTaskCatalog(db: D1Database, user: Identity) {
  return readTasks(db, "2000-01-01", "2100-12-31", user.userId);
}
export async function readBacklog(db: D1Database, user: Identity) {
  return (await db.prepare(`SELECT b.id,b.title,b.task_id AS taskId,t.title AS taskTitle,t.date AS taskDate,COALESCE(t.end_date,t.date) AS taskEndDate,a.id AS projectId,a.title AS projectTitle,a.color_hue AS projectHue,b.subtask,b.done FROM (
    SELECT id,title,task_id,artifact_id,owner_id,created_at,rowid AS position,0 AS subtask,0 AS done FROM task_backlog WHERE owner_id=?
    UNION ALL SELECT s.id,s.title,s.task_id,NULL,t.owner_id,s.created_at,s.sort_order,1,s.done FROM task_subtasks s JOIN tasks t ON t.id=s.task_id WHERE t.owner_id=? AND s.scheduled=0
  ) b LEFT JOIN tasks t ON t.id=b.task_id AND t.owner_id=b.owner_id LEFT JOIN work_task_links l ON l.task_id=t.id LEFT JOIN work_artifacts a ON a.id=CASE WHEN b.task_id IS NULL THEN b.artifact_id ELSE l.artifact_id END AND a.owner_id=b.owner_id ORDER BY b.done,b.created_at,b.position,b.id`).bind(user.userId, user.userId).all<BacklogItem>()).results;
}
export function dailyTaskItems(tasks: Task[], date: string): Array<{ id: string; title: string; done: boolean; parentTitle: string | null; subtask: boolean }> {
  return tasks.flatMap<{ id: string; title: string; done: boolean; parentTitle: string | null; subtask: boolean }>(task => task.subtasks.length
    ? task.subtasks.filter(child => child.date === date).map(child => ({ id: child.id, title: child.title, done: Boolean(child.done), parentTitle: task.title, subtask: true }))
    : !task.unscheduledCount && (!task.endDate || task.endDate === task.date) && task.date === date
      ? [{ id: task.id, title: task.title, done: Boolean(task.done), parentTitle: null, subtask: false }]
      : []
  ).sort((a, b) => Number(a.done) - Number(b.done));
}
export function calendarTaskLanes(tasks: Task[], from: string, to: string): Task[][] {
  const periods = tasks.filter(task => task.endDate && task.endDate > task.date && task.date <= to && task.endDate >= from);
  const lanes: Task[][] = [];
  for (const task of periods) {
    // Overlapping bars follow the same saved order as the task list.
    const index = lanes.findLastIndex(items => items.some(item => item.date <= task.endDate! && item.endDate! >= task.date)) + 1;
    (lanes[index] ??= []).push(task);
  }
  return lanes;
}
export function calendarWeekLayout(tasks: Task[], from: string, to: string) {
  const nextRows = Array<number>(7).fill(1);
  return tasks.filter(task => task.date <= to && (task.endDate ?? task.date) >= from).map(task => {
    const start = task.date < from ? from : task.date;
    const taskEnd = task.endDate ?? task.date;
    const end = taskEnd > to ? to : taskEnd;
    const column = (Date.parse(start) - Date.parse(from)) / 86_400_000;
    const span = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    // Preserve order on occupied days without reserving rows on unrelated days.
    const row = Math.max(...nextRows.slice(column, column + span));
    nextRows.fill(row + 1, column, column + span);
    return { task, start, end, column: column + 1, span, row };
  });
}
export function calendarWeekOffsets(cards: Array<{ column: number; span: number; height: number }>) {
  const bottoms = Array<number>(7).fill(0);
  return cards.map(({ column, span, height }) => {
    const top = Math.max(...bottoms.slice(column - 1, column - 1 + span));
    bottoms.fill(top + height + 8, column - 1, column - 1 + span);
    return top;
  });
}
export const projectColors = [
  { hue: 148, name: "초록" }, { hue: 218, name: "파랑" }, { hue: 278, name: "보라" }, { hue: 28, name: "주황" },
  { hue: 328, name: "분홍" }, { hue: 178, name: "청록" }, { hue: 55, name: "노랑" }, { hue: 245, name: "남색" },
];
export function taskHue(task: string | Pick<Task, "id" | "projectId" | "projectHue">) {
  if (typeof task !== "string" && task.projectId && task.projectHue != null) return task.projectHue;
  const id = typeof task === "string" ? task : task.projectId ?? task.id;
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return projectColors[hash % projectColors.length].hue;
}
export function calendarProjects(tasks: Task[]) {
  const groups = new Map<string, { id: string; title: string; hue: number; total: number; completed: number }>();
  for (const task of tasks) {
    if (!task.projectId) continue;
    const key = task.projectId;
    const group = groups.get(key) ?? { id: key, title: task.projectTitle ?? "프로젝트", hue: taskHue(task), total: 0, completed: 0 };
    group.total += 1;
    group.completed += Number(Boolean(task.done));
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function calendarTaskGroups(tasks: Task[], date: string) {
  return tasks.map(task => ({ task, items: dailyTaskItems([task], date) }))
    .filter(({ task, items }) => items.length > 0 && (task.subtasks.length > 0 || !task.endDate || task.endDate === task.date));
}
export function widgetPlan(data: DayData) {
  const items = data.tasks.filter(task => task.ownerId === data.me.id).flatMap(task =>
    dailyTaskItems([task], data.date).map(item => ({
      ...item, projectTitle: task.projectId ? task.projectTitle ?? null : null,
      projectHue: task.projectId ? taskHue(task) : null,
    }))
  ).sort((a, b) => Number(a.done) - Number(b.done));
  const next = data.milestones[0];
  return {
    date: data.date, accountID: data.me.id,
    tasks: items.slice(0, 4), taskCount: items.length, completedCount: items.filter(task => task.done).length,
    nextMilestone: next ? { title: next.title, date: next.date } : null,
  };
}
export async function listMilestones(db: D1Database, from: string, to: string, ownerId?: string) {
  day(from); day(to);
  if (to < from || to > addDays(from, 366)) throw new PlannerError("마일스톤 조회 기간은 1년 이내로 선택해주세요.");
  const result = await db.prepare("SELECT m.owner_id AS ownerId,m.calendar_id AS calendarId,m.event_id AS eventId,m.title,m.date,m.url,m.synced_at AS syncedAt,p.name AS ownerName,s.name AS sourceName FROM milestones m JOIN members p ON p.id=m.owner_id JOIN calendar_sources s ON s.calendar_id=m.calendar_id AND (? IS NULL OR s.owner_id=m.owner_id) LEFT JOIN milestone_order o ON o.calendar_id=m.calendar_id AND o.event_id=m.event_id WHERE m.date>=? AND m.date<=? AND (? IS NULL OR m.owner_id=?) ORDER BY o.position IS NULL,o.position,m.date,m.title,m.calendar_id,m.event_id LIMIT 1000").bind(ownerId ?? null, from, to, ownerId ?? null, ownerId ?? null).all<Milestone>();
  return result.results;
}
export async function readDay(db: D1Database, user: Identity, date: string, personalCalendars = false): Promise<DayData> {
  day(date);
  await ensureMember(db, user);
  const calendarOwner = personalCalendars ? user.userId : null;
  const [people, tasks, notes, milestones, sources, projects] = await Promise.all([
    db.prepare("SELECT id,name FROM members ORDER BY joined_at,id").all<Member>(),
    readTasks(db, date, date, null, user.userId),
    db.prepare("SELECT n.owner_id AS ownerId,n.date,n.content,n.updated_at AS updatedAt,p.name AS ownerName FROM notes n JOIN members p ON p.id=n.owner_id WHERE n.date=? AND (? IS NULL OR n.owner_id=?)").bind(date, calendarOwner, calendarOwner).all<Note>(),
    listMilestones(db, date, addDays(date, 90) > "2100-12-31" ? "2100-12-31" : addDays(date, 90), calendarOwner ?? undefined),
    db.prepare("SELECT s.owner_id AS ownerId,s.calendar_id AS calendarId,s.name,s.synced_at AS syncedAt,p.name AS ownerName FROM calendar_sources s JOIN members p ON p.id=s.owner_id WHERE (? IS NULL OR s.owner_id=?) ORDER BY s.synced_at DESC").bind(calendarOwner, calendarOwner).all<Source>(),
    db.prepare("SELECT id,title FROM work_artifacts WHERE owner_id=? ORDER BY title,id").bind(user.userId).all<TaskProject>(),
  ]);
  return { date, me: people.results.find(p => p.id === user.userId)!, members: people.results, tasks, projects: projects.results, notes: notes.results, milestones, sources: sources.results };
}
export function monthRange(date: string) {
  day(date);
  return { from: date.slice(0, 7) + "-01", to: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10) };
}
export function weekRange(date: string) {
  day(date);
  const offset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const from = addDays(date, -offset), to = addDays(date, 6 - offset);
  return { from: from < "2000-01-01" ? "2000-01-01" : from, to: to > "2100-12-31" ? "2100-12-31" : to };
}
export async function readCalendar(db: D1Database, user: Identity, date: string, view: "week" | "month" = "month"): Promise<CalendarData> {
  const { from, to } = view === "week" ? weekRange(date) : monthRange(date);
  const [tasks, milestones] = await Promise.all([
    readTasks(db, from, to, user.userId),
    listMilestones(db, from, to, user.userId),
  ]);
  return { from, to, tasks, milestones };
}
export async function change(db: D1Database, user: Identity, input: Record<string, unknown>, taskDate?: string): Promise<{ id: string } | { saved: boolean }> {
  await ensureMember(db, user);
  const now = new Date().toISOString();
  if (input.op === "backlog.add") {
    const id = crypto.randomUUID(), title = text(input.title, "할 일", 240);
    const parentId = input.taskId == null ? null : text(input.taskId, "상위 할 일", 100);
    const projectId = input.projectId == null ? null : text(input.projectId, "프로젝트", 100);
    if (parentId && !(await db.prepare("SELECT id FROM tasks WHERE id=? AND owner_id=?").bind(parentId, user.userId).all()).results.length) throw new PlannerError("본인의 작업을 선택해 주세요.", 403);
    if (projectId && !(await db.prepare("SELECT id FROM work_artifacts WHERE id=? AND owner_id=?").bind(projectId, user.userId).all()).results.length) throw new PlannerError("본인의 프로젝트를 선택해 주세요.", 403);
    await db.prepare("INSERT INTO task_backlog (id,owner_id,task_id,artifact_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, user.userId, parentId, parentId ? null : projectId, title, now, now).run();
    return { id };
  }
  if (input.op === "backlog.patch" || input.op === "backlog.delete" || input.op === "backlog.schedule") {
    const id = text(input.id, "할 일 ID", 100);
    const existingChild = (await db.prepare("SELECT s.id FROM task_subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND t.owner_id=? AND s.scheduled=0").bind(id, user.userId).all()).results[0];
    if (existingChild) return change(db, user, input.op === "backlog.delete" ? { op: "subtask.delete", id } : { op: "subtask.patch", id, ...(input.op === "backlog.schedule" ? { date: day(input.date) } : { title: input.title }) });
    if (input.op !== "backlog.schedule") {
      const statement = input.op === "backlog.delete"
        ? db.prepare("DELETE FROM task_backlog WHERE id=? AND owner_id=?").bind(id, user.userId)
        : db.prepare("UPDATE task_backlog SET title=?,updated_at=? WHERE id=? AND owner_id=?").bind(text(input.title, "할 일", 240), now, id, user.userId);
      if (!(await statement.run()).meta.changes) throw new PlannerError("날짜 미정 할 일을 찾을 수 없어요.", 404);
      return { id };
    }
    const date = day(input.date);
    const item = (await db.prepare("SELECT task_id AS taskId FROM task_backlog WHERE id=? AND owner_id=?").bind(id, user.userId).all<{ taskId: string | null }>()).results[0];
    if (!item) throw new PlannerError("이미 날짜를 정했거나 삭제된 할 일이에요.", 409);
    const statements = item.taskId ? [
      db.prepare("INSERT INTO task_subtasks (id,task_id,date,title,done,created_at,updated_at,sort_order) SELECT b.id,b.task_id,?,b.title,0,b.created_at,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM task_subtasks WHERE task_id=b.task_id) FROM task_backlog b JOIN tasks t ON t.id=b.task_id AND t.owner_id=b.owner_id WHERE b.id=? AND b.owner_id=? AND ? BETWEEN t.date AND COALESCE(t.end_date,t.date)").bind(date, now, id, user.userId, date),
    ] : [
      db.prepare("INSERT INTO tasks (id,owner_id,date,title,done,important,created_at,updated_at,sort_order) SELECT b.id,b.owner_id,?,b.title,0,0,b.created_at,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM tasks WHERE owner_id=b.owner_id) FROM task_backlog b WHERE b.id=? AND b.owner_id=? AND b.task_id IS NULL").bind(date, now, id, user.userId),
      db.prepare("INSERT INTO work_task_links (task_id,artifact_id) SELECT b.id,b.artifact_id FROM task_backlog b JOIN tasks t ON t.id=b.id AND t.owner_id=b.owner_id WHERE b.id=? AND b.owner_id=? AND b.artifact_id IS NOT NULL").bind(id, user.userId),
    ];
    statements.push(db.prepare(`DELETE FROM task_backlog WHERE id=? AND owner_id=? AND EXISTS (SELECT 1 FROM ${item.taskId ? "task_subtasks" : "tasks"} WHERE id=task_backlog.id)`).bind(id, user.userId));
    const result = await db.batch(statements);
    if (!result[0].meta.changes) throw new PlannerError("작업 기간 안에서 날짜를 선택해 주세요. 날짜 미정 할 일은 보관되어 있어요.", 409);
    return { id };
  }
  if (input.op === "task.move" || input.op === "subtask.move") {
    const id = text(input.id, "할 일 ID", 100), targetId = text(input.targetId, "이동할 위치", 100);
    const date = day(input.date);
    const tasks = await readTasks(db, date, date, user.userId);
    const isChild = input.op === "subtask.move";
    const siblings = isChild ? tasks.find(task => task.subtasks.some(child => child.id === id))?.subtasks ?? [] : tasks;
    const source = siblings.find(item => item.id === id), target = siblings.find(item => item.id === targetId);
    if (!source || !target) throw new PlannerError("같은 목록에 있는 본인의 할 일만 옮길 수 있어요.", 403);
    if (source.done !== target.done) throw new PlannerError("완료한 할 일은 목록 아래에 표시됩니다.", 409);
    if (id === targetId) return { saved: true };
    const ordered = siblings.filter(item => item.done === source.done);
    const positions = ordered.map(item => item.sortOrder);
    const from = ordered.findIndex(item => item.id === id), to = ordered.findIndex(item => item.id === targetId);
    if (input.position !== undefined && input.position !== "before" && input.position !== "after") throw new PlannerError("올바른 이동 위치가 아닙니다.");
    const [moving] = ordered.splice(from, 1);
    const targetIndex = ordered.findIndex(item => item.id === targetId);
    ordered.splice(input.position === undefined ? to : targetIndex + Number(input.position === "after"), 0, moving);
    await db.batch(ordered.map((item, index) => isChild
      ? db.prepare("UPDATE task_subtasks SET sort_order=?,updated_at=? WHERE id=? AND task_id IN (SELECT id FROM tasks WHERE owner_id=?)").bind(positions[index], now, item.id, user.userId)
      : db.prepare("UPDATE tasks SET sort_order=?,updated_at=? WHERE id=? AND owner_id=?").bind(positions[index], now, item.id, user.userId)));
    return { saved: true };
  }
  if (input.op === "milestones.reorder") {
    const date = day(input.date);
    if (!Array.isArray(input.order) || input.order.length > 1000) throw new PlannerError("올바른 마일스톤 순서가 아닙니다.");
    const order = input.order.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlannerError("올바른 마일스톤 순서가 아닙니다.");
      const item = value as Record<string, unknown>;
      return { calendarId: text(item.calendarId, "캘린더 ID", 300), eventId: text(item.eventId, "일정 ID", 1024) };
    });
    const keys = new Set(order.map(milestoneKey));
    if (keys.size !== order.length) throw new PlannerError("중복된 마일스톤이 있습니다.");
    const current = await listMilestones(db, date, addDays(date, 90) > "2100-12-31" ? "2100-12-31" : addDays(date, 90));
    if (current.length !== order.length || current.some(item => !keys.has(milestoneKey(item)))) throw new PlannerError("마일스톤 목록이 바뀌었어요. 새로고침 후 다시 옮겨주세요.", 409);
    if (order.length) await db.batch(order.map((item, position) => db.prepare("INSERT INTO milestone_order (calendar_id,event_id,position) VALUES (?,?,?) ON CONFLICT(calendar_id,event_id) DO UPDATE SET position=excluded.position").bind(item.calendarId, item.eventId, position)));
    return { saved: true };
  }
  if (input.op === "task.add") {
    const id = crypto.randomUUID();
    const date = day(input.date), endDate = input.endDate == null ? null : day(input.endDate);
    if (endDate && endDate < date) throw new PlannerError("종료일은 시작일 이후로 선택해주세요.");
    const projectId = input.projectId == null ? null : text(input.projectId, "프로젝트", 100);
    if (projectId && !(await db.prepare("SELECT id FROM work_artifacts WHERE id=? AND owner_id=?").bind(projectId, user.userId).all()).results.length) throw new PlannerError("본인의 프로젝트를 선택해 주세요.", 403);
    const statements = [db.prepare("INSERT INTO tasks (id,owner_id,date,end_date,title,done,important,created_at,updated_at,sort_order) VALUES (?,?,?,?,?,0,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM tasks WHERE owner_id=?))").bind(id, user.userId, date, endDate, text(input.title, "할 일", 240), input.important === undefined ? 0 : bool(input.important), now, now, user.userId)];
    if (projectId) statements.push(db.prepare("INSERT INTO work_task_links (task_id,artifact_id) VALUES (?,?)").bind(id, projectId));
    await db.batch(statements);
    return { id };
  }
  if (input.op === "subtask.add" || input.op === "subtask.patch" || input.op === "subtask.delete") {
    const adding = input.op === "subtask.add";
    const id = adding ? crypto.randomUUID() : text(input.id, "하위 할 일 ID", 100);
    const taskId = adding ? text(input.taskId, "할 일 ID", 100) : null;
    const parent = await db.prepare(`SELECT t.id,t.date,t.end_date AS endDate,CASE WHEN s.scheduled=1 THEN s.date ELSE NULL END AS childDate FROM tasks t LEFT JOIN task_subtasks s ON s.task_id=t.id AND s.id=? WHERE t.owner_id=? AND ${adding ? "t.id=?" : "s.id=?"}`).bind(id, user.userId, taskId ?? id).all<{ id: string; date: string; endDate: string | null; childDate: string | null }>();
    const task = parent.results[0];
    if (!task) throw new PlannerError("본인의 하위 할 일만 변경할 수 있어요.", 403);
    if (taskDate !== undefined && task.childDate !== taskDate) throw new PlannerError("위젯을 새로고침해 주세요.", 409);
    if (input.op === "subtask.delete") {
      await db.prepare("DELETE FROM task_subtasks WHERE id=? AND task_id IN (SELECT id FROM tasks WHERE owner_id=?)").bind(id, user.userId).run();
      return { id };
    }
    const requestedDate = input.date === undefined ? task.childDate : input.date;
    const date = requestedDate === null ? null : day(requestedDate);
    if (date !== null && (date < task.date || date > (task.endDate ?? task.date))) throw new PlannerError("하위 할 일의 날짜는 전체 할 일 기간 안에서 선택해주세요.");
    let result;
    if (adding) {
      result = await db.prepare("INSERT INTO task_subtasks (id,task_id,date,scheduled,title,done,created_at,updated_at,sort_order) SELECT ?,id,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM task_subtasks WHERE task_id=tasks.id) FROM tasks WHERE id=? AND owner_id=? AND (? IS NULL OR ? BETWEEN date AND COALESCE(end_date,date))").bind(id, date ?? task.date, Number(date !== null), text(input.title, "하위 할 일", 240), 0, now, now, task.id, user.userId, date, date).run();
    } else {
      const fields = ["updated_at=?"];
      const values: (string | number)[] = [now];
      // Keep the row and its last date so clearing a schedule preserves record links and order.
      if (input.date !== undefined) {
        fields.push("scheduled=?"); values.push(Number(date !== null));
        if (date !== null) { fields.push("date=?"); values.push(date); }
      }
      if (input.title !== undefined) { fields.push("title=?"); values.push(text(input.title, "하위 할 일", 240)); }
      if (input.done !== undefined) { fields.push("done=?"); values.push(bool(input.done)); }
      if (fields.length === 1) throw new PlannerError("변경할 내용을 입력해주세요.");
      result = await db.prepare(`UPDATE task_subtasks SET ${fields.join(",")} WHERE id=? AND (? IS NULL OR (scheduled=1 AND date=?)) AND task_id IN (SELECT id FROM tasks WHERE owner_id=? AND (? IS NULL OR ? BETWEEN date AND COALESCE(end_date,date)))`).bind(...values, id, taskDate ?? null, taskDate ?? null, user.userId, date, date).run();
    }
    if (!result.meta.changes) throw new PlannerError("할 일 기간이 바뀌었어요. 새로고침 후 다시 시도해주세요.", 409);
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
    const values: (string | number | null)[] = [];
    const current = (await db.prepare("SELECT date,end_date AS endDate FROM tasks WHERE id=? AND owner_id=?").bind(id, user.userId).all<{ date: string; endDate: string | null }>()).results[0];
    if (!current) throw new PlannerError("본인의 할 일만 수정할 수 있어요.", 403);
    const start = input.date === undefined ? current.date : day(input.date);
    const end = input.endDate === undefined ? current.endDate : input.endDate === null ? null : day(input.endDate);
    if (end && end < start) throw new PlannerError("종료일은 시작일 이후로 선택해주세요.");
    if (input.title !== undefined) { fields.push("title=?"); values.push(text(input.title, "할 일", 240)); }
    if (input.date !== undefined) { fields.push("date=?"); values.push(day(input.date)); }
    if (input.endDate !== undefined) { fields.push("end_date=?"); values.push(end); }
    if (input.done !== undefined) { fields.push("done=?"); values.push(bool(input.done)); }
    if (input.important !== undefined) { fields.push("important=?"); values.push(bool(input.important)); }
    if (!fields.length) throw new PlannerError("변경할 내용을 입력해주세요.");
    const result = await db.prepare(`UPDATE tasks SET ${fields.join(",")},updated_at=? WHERE id=? AND owner_id=? AND (? IS NULL OR ? BETWEEN date AND COALESCE(end_date,date)) AND NOT EXISTS (SELECT 1 FROM task_subtasks WHERE task_id=tasks.id AND ((scheduled=1 AND (date<? OR date>?)) OR ?)) AND (?=0 OR NOT EXISTS (SELECT 1 FROM task_backlog WHERE task_id=tasks.id))`).bind(...values, now, id, user.userId, taskDate ?? null, taskDate ?? null, start, end ?? start, input.done !== undefined ? 1 : 0, input.done === true ? 1 : 0).run();
    if (!result.meta.changes) throw new PlannerError("하위 할 일의 날짜를 포함하는 기간을 선택하고, 완료는 하위 할 일별로 체크해주세요.", 409);
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
export async function syncMilestones(db: D1Database, user: Identity, input: Record<string, unknown>, personalCalendar = false) {
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
    db.prepare("INSERT INTO calendar_sources (owner_id,calendar_id,name,synced_at) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET owner_id=excluded.owner_id,name=excluded.name,synced_at=excluded.synced_at").bind(user.userId, calendarId, name, now),
    db.prepare("DELETE FROM milestones WHERE calendar_id=? AND date>=? AND date<=? AND (? IS NULL OR owner_id=?)").bind(calendarId, from, to, personalCalendar ? user.userId : null, personalCalendar ? user.userId : null),
    ...events.map(event => db.prepare("INSERT INTO milestones (owner_id,calendar_id,event_id,title,date,url,synced_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET owner_id=excluded.owner_id,title=excluded.title,date=excluded.date,url=excluded.url,synced_at=excluded.synced_at").bind(user.userId, calendarId, event.eventId, event.title, event.date, event.url, now)),
  ]);
  return { count: events.length, from, to, syncedAt: now, message: "팀 공통 마일스톤을 갱신했습니다. 일일 할 일은 변경하지 않았습니다." };
}
