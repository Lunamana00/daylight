"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, LoaderCircle, LockKeyhole, RefreshCw, Settings2, Share2, Sun, Sunrise, Users, X } from "lucide-react";
import { addDays, dailyTaskItems, today } from "../lib/planner-core";
import type { BacklogItem, DayData, Subtask, Task } from "../lib/planner-core";
import { PlannerCalendar } from "../components/planner-calendar";
import { PlannerDailySubtask, PlannerTask } from "../components/planner-task";
import { PlannerBacklogRow } from "../components/planner-backlog";
import { WorkLog } from "../components/work-log";

type View = "mine" | "together" | "work";
type Modal = "connections" | "share" | "delete" | "task" | null;
type Invitations = { canInvite: boolean; invitations: Array<{ email: string; joined: number }> };
const shortDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(date + "T00:00:00Z"));
const longDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
const weekday = (date: string) => new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
const syncTime = (time: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(time));
function Avatar({ name, index = 0, small = false }: { name: string; index?: number; small?: boolean }) {
  return <span className={`avatar color-${index % 5} ${small ? "small" : ""}`} aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>;
}

export default function Planner({ googleLogin = false }: { googleLogin?: boolean }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<DayData | null>(null);
  const [view, setView] = useState<View>("mine");
  const [taskLayout, setTaskLayout] = useState<"split" | "list">("split");
  const [taskScope, setTaskScope] = useState<"day" | "all">("day");
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [deleteBacklog, setDeleteBacklog] = useState<BacklogItem | null>(null);
  const [catalog, setCatalog] = useState<Task[] | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [workTask, setWorkTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState("all");
  const [person, setPerson] = useState("all");
  const [draft, setDraft] = useState("");
  const [draftUnscheduled, setDraftUnscheduled] = useState(false);
  const [draftProject, setDraftProject] = useState("");
  const [periodStart, setPeriodStart] = useState(date);
  const [periodEnd, setPeriodEnd] = useState(date);
  const [nameDraft, setNameDraft] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitations, setInvitations] = useState<Invitations | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draggedTask, setDraggedTask] = useState<Pick<Task, "id" | "done" | "date" | "endDate"> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [deleteChild, setDeleteChild] = useState<Subtask | null>(null);
  const [calendarTask, setCalendarTask] = useState<Task | null>(null);
  const [calendarChildId, setCalendarChildId] = useState<string>();
  const dateRef = useRef(date);
  const sequence = useRef(0);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  dateRef.current = date;

  const load = useCallback(async (targetDate: string, show = false) => {
    const serial = ++sequence.current;
    if (show) setRefreshing(true);
    try {
      const response = await fetch(`/api/planner?date=${targetDate}`, { cache: "no-store" });
      const value = await response.json() as DayData & { error?: string };
      if (!response.ok) throw new Error(value.error || "계획을 불러오지 못했어요.");
      if (dateRef.current === targetDate && serial === sequence.current) { setData(value); setError(""); }
    } catch (err) {
      if (dateRef.current === targetDate && serial === sequence.current) setError(err instanceof Error ? err.message : "연결을 확인해주세요.");
    } finally { if (show) setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (view !== "mine") setData(null);
    setPeriodStart(date); setPeriodEnd(date);
    void load(date);
  }, [date, load, view]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("daylight.task-layout.v1");
      if (saved === "list" || saved === "split") setTaskLayout(saved);
    } catch { /* The split layout also works when browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    if (view !== "mine" || !data) return;
    let active = true;
    setCatalogError("");
    void (async () => {
      try {
        const response = await fetch("/api/planner?view=tasks", { cache: "no-store" });
        const value = await response.json() as { tasks: Task[]; backlog: BacklogItem[]; error?: string };
        if (!response.ok) throw new Error(value.error || "전체 작업을 불러오지 못했어요.");
        if (active) { setCatalog(value.tasks); setBacklog(value.backlog); }
      } catch (err) { if (active) setCatalogError(err instanceof Error ? err.message : "전체 작업을 불러오지 못했어요."); }
    })();
    return () => { active = false; };
  }, [view, data]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy && !draggedTask) void load(dateRef.current); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [busy, draggedTask, load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    if (!modal && dialog.current?.open) dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (modal === "connections" && data) setNameDraft(data.me.name);
  }, [modal, data?.me.name]);
  useEffect(() => {
    if (modal !== "share" || !googleLogin) return;
    let active = true;
    setInvitations(null); setInviteError(""); setInviteMessage("");
    void (async () => {
      try {
        const response = await fetch("/api/invitations", { cache: "no-store" });
        const value = await response.json() as Invitations & { error?: string };
        if (!response.ok) throw new Error(value.error || "초대 목록을 불러오지 못했어요.");
        if (active) setInvitations(value);
      } catch (err) { if (active) setInviteError(err instanceof Error ? err.message : "연결을 확인해 주세요."); }
    })();
    return () => { active = false; };
  }, [modal, googleLogin]);

  async function invite() {
    if (inviteBusy) return;
    setInviteBusy(true); setInviteError(""); setInviteMessage("");
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail }) });
      const value = await response.json() as Invitations & { error?: string };
      if (!response.ok) throw new Error(value.error || "초대를 추가하지 못했어요.");
      setInvitations(value); setInviteEmail("");
      setInviteMessage("초대 목록에 추가했어요. 아래 링크를 전달해 주세요.");
    } catch (err) { setInviteError(err instanceof Error ? err.message : "연결을 확인해 주세요."); }
    finally { setInviteBusy(false); }
  }

  async function mutate(input: Record<string, unknown>, message?: string) {
    if (busy) return false;
    setBusy(true); setError("");
    const targetDate = date;
    ++sequence.current;
    try {
      const linking = input.op === "task.link";
      const response = await fetch(linking ? "/api/worklog" : "/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, viewDate: targetDate }) });
      const value = await response.json() as DayData & { error?: string };
      if (!response.ok) throw new Error(value.error || "변경 사항을 저장하지 못했어요.");
      if (linking) await load(targetDate);
      else if (dateRef.current === targetDate) setData(value);
      if (message) setToast(message);
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "연결을 확인해주세요."); return false; }
    finally { setBusy(false); }
  }
  function selectDate(value: string) {
    if (busy || !value || value < "2000-01-01" || value > "2100-09-01") return;
    setDate(value);
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setToast(message); }
    catch { setError("복사하지 못했어요. 아래 내용을 직접 선택해 복사해주세요."); }
  }
  const myTasks = data?.tasks.filter(task => task.ownerId === data.me.id && dailyTaskItems([task], date).length > 0) || [];
  const ownCatalog = catalog?.filter(task => task.ownerId === data?.me.id) ?? [];
  const groupTasks = ownCatalog.filter(task => task.subtasks.length > 0 || task.unscheduledCount || (task.endDate && task.endDate > task.date));
  const inspectedTask = data?.tasks.find(task => task.id === calendarTask?.id) ?? ownCatalog.find(task => task.id === calendarTask?.id) ?? calendarTask;
  const dailyItems = dailyTaskItems(myTasks, date);
  const completed = dailyItems.filter(task => task.done).length;
  const dailyRows = myTasks.flatMap(task => dailyTaskItems([task], date).map(item => ({ task, item })))
    .sort((a, b) => Number(a.item.done) - Number(b.item.done))
    .filter(({ item }) => filter === "all" || (filter === "done" ? item.done : !item.done));
  const mondayOffset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monday = addDays(date, -mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const connectionPrompt = calendarName.trim() ? `daylight 사이트 ${typeof window !== "undefined" ? window.location.origin : ""}의 연결된 도구를 사용해줘. Google Calendar에서 내가 팀에 공유할 마일스톤용으로 지정하는 캘린더 ${JSON.stringify(calendarName.trim())}만 읽어서, 한국 시간 오늘부터 90일 뒤까지의 마일스톤을 daylight에 동기화해줘. 페이지가 여러 개면 끝까지 읽고 성공한 뒤에만 sync_google_calendar_milestones를 호출해. 이 캘린더 일정이 사이트의 모든 팀원에게 공유되는 것을 허용해. 일정의 원래 ID와 제목을 유지하고, 종일 일정은 start.date, 시간 일정은 한국 시간 시작 날짜를 사용해. Google 캘린더에는 아무것도 쓰지 마. 내가 직접 작성한 일일 할 일은 get_daily_plan으로 읽기만 하고 추가·수정·완료 처리하지 마. 자동 실행은 아직 설정하지 마.` : "";

  function openTask(task: Task, childId?: string) {
    const child = task.subtasks.find(item => item.id === childId);
    selectDate(child?.date ?? (date >= task.date && date <= (task.endDate ?? task.date) ? date : task.date));
    setCalendarTask(task); setCalendarChildId(childId); setModal("task");
  }
  function removeTask(parent: Task, child?: Subtask) {
    setDeleteTask(parent); setDeleteChild(child ?? null); setDeleteBacklog(null); setModal("delete");
  }
  function removeBacklog(item: BacklogItem) { setDeleteBacklog(item); setDeleteTask(null); setDeleteChild(null); setModal("delete"); }
  function taskRow(task: Task, { readOnly = false, managePeriod = false, grouped = false, order = myTasks }: { readOnly?: boolean; managePeriod?: boolean; grouped?: boolean; order?: Task[] } = {}) {
    const rowDate = date >= task.date && date <= (task.endDate ?? task.date) ? date : task.date;
    const ordered = order.filter(item => item.done === task.done && item.date <= rowDate && (item.endDate ?? item.date) >= rowDate);
    const index = ordered.findIndex(item => item.id === task.id);
    return <PlannerTask key={`${rowDate}-${task.id}`} task={task} projects={data?.projects ?? []} date={rowDate} busy={busy} readOnly={readOnly} grouped={grouped} backlog={readOnly ? [] : backlog.filter(item => item.taskId === task.id && !item.subtask)} onDeleteBacklog={removeBacklog} showDate={grouped || order === ownCatalog} reorderable={!managePeriod} initialEditing={managePeriod && !calendarChildId} initialChildId={managePeriod ? calendarChildId : undefined} previousTaskId={ordered[index - 1]?.id} nextTaskId={ordered[index + 1]?.id} draggedTask={draggedTask} onDragStart={() => setDraggedTask({ id: task.id, done: task.done, date: task.date, endDate: task.endDate })} onDragEnd={() => setDraggedTask(null)} onChange={async (input, message) => {
      const saved = await mutate(input, message);
      if (saved && managePeriod && input.op === "task.patch" && typeof input.date === "string") selectDate(input.date);
      return saved;
    }} onOpenWorkLog={readOnly ? undefined : task => { setWorkTask(task); setView("work"); setModal(null); }} onDelete={removeTask} />;
  }

  function catalogRows(tasks: Task[], empty: string) {
    const active = tasks.filter(task => !task.done), finished = tasks.filter(task => task.done);
    const undated = backlog.filter(item => !item.taskId);
    const row = (task: Task) => taskRow(task, { order: tasks, grouped: Boolean(task.endDate && task.endDate > task.date) || task.subtasks.length > 0 || Boolean(task.unscheduledCount) });
    return <>{catalogError && <p className="error-banner" role="alert">{catalogError}<button onClick={() => void load(date, true)}>다시 시도</button></p>}
      {catalog === null ? <p className="empty-tasks" role="status">{catalogError ? "작업을 불러오지 못했어요." : "작업 불러오는 중…"}</p> : <>
        {active.length || undated.length ? <ul className="task-list task-work-list">{active.map(row)}{undated.map(item => <PlannerBacklogRow key={item.id} item={item} date={date} busy={busy} onChange={mutate} onDelete={removeBacklog} />)}</ul> : <p className="empty-tasks">{empty}</p>}
        {finished.length > 0 && <details className="completed-work"><summary>완료한 작업 <span>{finished.length}</span></summary><ul className="task-list task-work-list">{finished.map(row)}</ul></details>}
      </>}
    </>;
  }
  const dailyPanel = <section className="task-day-pane" aria-label={`${shortDate(date)} 할 일`}>
    <div className="task-pane-heading"><h3>{date === today() ? "오늘 할 일" : `${shortDate(date)} 할 일`}</h3><span><strong>{completed}</strong> / {dailyItems.length} 완료</span></div>
    <div className="task-progress"><span style={{ width: `${dailyItems.length ? completed / dailyItems.length * 100 : 0}%` }} /></div>
    <div className="task-filter" aria-label="할 일 필터">{[["all", "전체"], ["open", "미완료"], ["done", "완료"]].map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}{key === "done" && <span>{completed}</span>}</button>)}</div>
    {dailyRows.length ? <ul className="task-list task-day-list">{dailyRows.map(({ task, item }) => item.subtask
      ? <PlannerDailySubtask key={item.id} task={task} child={task.subtasks.find(child => child.id === item.id)!} date={date} busy={busy} onChange={mutate} onOpenTask={openTask} onDelete={removeTask} />
      : taskRow(task, { order: myTasks.filter(item => !item.subtasks.length) }))}</ul>
      : <p className="empty-tasks">{myTasks.length ? filter === "done" ? "완료한 할 일 없음" : "남은 할 일 없음" : "오늘 할 일 없음"}</p>}
  </section>;
  const composer = <form className="task-composer" onKeyDown={event => {
                if (event.key !== "Enter" || !event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                event.preventDefault();
                if (!event.repeat && !busy && draft.trim()) event.currentTarget.requestSubmit();
              }} onSubmit={async event => {
                event.preventDefault();
                if (busy || !draft.trim()) return;
                if (await mutate({ op: draftUnscheduled ? "backlog.add" : "task.add", date: periodStart, endDate: periodEnd === periodStart ? null : periodEnd, title: draft, projectId: draftProject || null }, draftUnscheduled ? "작업 목록에 추가했어요." : periodEnd > periodStart ? "기간을 달력에 추가했어요." : undefined)) {
                  setDraft("");
                  setFilter("all");
                  if (draftUnscheduled) setTaskScope("all"); else selectDate(periodStart);
                  taskInput.current?.focus();
                }
              }}>
                <textarea ref={taskInput} value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={240} placeholder="새 할 일" aria-label="새 할 일" disabled={busy} />
                <div className="task-composer-footer"><label className="schedule-checkbox"><input type="checkbox" aria-label="새 할 일 날짜 지정" checked={!draftUnscheduled} disabled={busy} onChange={event => setDraftUnscheduled(!event.target.checked)} />날짜 지정</label><div className="task-period-fields" aria-disabled={draftUnscheduled}>
                  <label>시작일<input type="date" value={periodStart} min="2000-01-01" max="2100-09-01" required={!draftUnscheduled} disabled={busy || draftUnscheduled} onChange={event => { const value = event.target.value; setPeriodStart(value); setPeriodEnd(end => end < value ? value : end); }} /></label>
                  <span>—</span><label>종료일<input type="date" value={periodEnd} min={periodStart} max="2100-09-01" required={!draftUnscheduled} disabled={busy || draftUnscheduled} onChange={event => setPeriodEnd(event.target.value)} /></label>
                </div><label className="task-composer-project">프로젝트<select value={draftProject} disabled={busy} onChange={event => setDraftProject(event.target.value)}><option value="">미지정</option>{data?.projects?.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><button aria-label="할 일 추가" aria-keyshortcuts="Meta+Enter" title="할 일 추가 (⌘ Enter)" disabled={busy || !draft.trim()}>추가</button></div>
              </form>;

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="sidebar-brand" aria-label="daylight 오늘로" onClick={() => { setView("mine"); selectDate(today()); }}>
        <Sun size={23} strokeWidth={1.65} aria-hidden="true" />
        <span>daylight<span className="sidebar-brand-dot">.</span></span>
      </button>
      <nav aria-label="주 메뉴">
        <button aria-current={view === "mine" ? "page" : undefined} onClick={() => setView("mine")}><Sunrise size={18} />내 할 일</button>
        <button aria-current={view === "work" ? "page" : undefined} onClick={() => { setWorkTask(null); setView("work"); }}><FolderOpen size={18} />작업물</button>
        <button aria-current={view === "together" ? "page" : undefined} onClick={() => { setView("together"); setPerson("all"); }}><Users size={18} />서로의 오늘</button>
        <button title="함께 볼 사람 초대" onClick={() => setModal("share")}><Share2 size={18} />공유</button>
        <button title="연결 및 내 프로필" onClick={() => setModal("connections")}><Settings2 size={18} />설정</button>
      </nav>
    </aside>
    <div className="main-shell">
      <main>
        <h1 className="sr-only">{view === "mine" ? "내 할 일" : view === "work" ? "작업물" : "서로의 오늘"}</h1>
        {view === "work" ? <WorkLog task={workTask} onClearTask={() => setWorkTask(null)} onOpenTask={value => { selectDate(value); setView("mine"); }} /> : <div className="date-toolbar"><div className="date-title"><CalendarDays size={17} /><strong>{longDate(date)}</strong>{date === today() && <span className="today-tag">오늘</span>}</div><div className="date-controls"><button className="text-button" onClick={() => selectDate(today())} disabled={busy}>오늘로</button><label className="date-picker"><CalendarDays size={15} /><input type="date" value={date} min="2000-01-01" max="2100-09-01" onChange={event => selectDate(event.target.value)} disabled={busy} aria-label="날짜 선택" /></label><button className={`icon-button ${refreshing ? "rotating" : ""}`} onClick={() => void load(date, true)} disabled={refreshing || busy} aria-label="새로고침"><RefreshCw size={15} /></button></div></div>}
        {error && <div className="error-banner" role="alert"><span>{error}{data ? " 마지막으로 불러온 내용을 표시하고 있어요." : ""}</span><button onClick={() => void load(date, true)}>다시 시도</button></div>}
        {view === "together" && <div className="week-strip"><button className="icon-button week-arrow" aria-label="지난주" onClick={() => selectDate(addDays(date, -7))} disabled={busy || date < "2000-01-08"}><ChevronLeft size={17} /></button>{week.map(value => <button key={value} className={`week-day ${value === date ? "selected" : ""} ${value === today() ? "actual-today" : ""}`} disabled={busy} onClick={() => selectDate(value)} aria-pressed={value === date}><span>{weekday(value)}</span><strong>{Number(value.slice(-2))}</strong><i /></button>)}<button className="icon-button week-arrow" aria-label="다음주" onClick={() => selectDate(addDays(date, 7))} disabled={busy || date > "2100-08-25"}><ChevronRight size={17} /></button></div>}
        {view !== "work" && (!data ? (!error && <div className="loading-state" role="status"><LoaderCircle size={23} className="spin" /><p>불러오는 중…</p></div>) : <div className="content-grid">
          <div className="primary-column">
            {view === "mine" && (data.date === date ? <section className={`card task-workspace layout-${taskLayout}`} aria-label="내 할 일 작업 공간">
              <div className="task-workspace-heading"><h2>내 할 일</h2><label className="task-layout-picker"><span>보기</span><select aria-label="할 일 화면 구성" value={taskLayout} disabled={busy || Boolean(draggedTask)} onChange={event => {
                const value = event.target.value === "list" ? "list" : "split";
                setTaskLayout(value);
                try { localStorage.setItem("daylight.task-layout.v1", value); } catch { /* Keep the current choice in memory. */ }
              }}><option value="split">작업·오늘 분할형</option><option value="list">목록 전환형</option></select></label></div>
              {taskLayout === "list" && <div className="task-scope-switch" role="group" aria-label="작업 표시 범위"><button className={taskScope === "day" ? "selected" : ""} aria-pressed={taskScope === "day"} disabled={busy || Boolean(draggedTask)} onClick={() => setTaskScope("day")}>{date === today() ? "오늘" : "선택한 날"}</button><button className={taskScope === "all" ? "selected" : ""} aria-pressed={taskScope === "all"} disabled={busy || Boolean(draggedTask)} onClick={() => setTaskScope("all")}>전체 작업</button></div>}
              {taskLayout === "split" ? <div className="task-split-panes"><section className="task-group-pane" aria-label="작업 관리"><div className="task-pane-heading"><h3>진행 중인 일</h3></div>{catalogRows(groupTasks, "진행 중인 일이 없어요.")}</section>{dailyPanel}</div> : taskScope === "day" ? dailyPanel : <section className="task-all-pane" aria-label="전체 작업">{catalogRows(ownCatalog, "아직 등록한 작업이 없어요.")}</section>}
              {composer}
            </section> : <p className="calendar-status" role="status">{error ? "이 날짜의 할 일을 불러오지 못했어요." : "할 일 불러오는 중…"}</p>)}
            {view === "mine" && <PlannerCalendar date={date} data={data} busy={busy} onChange={mutate} onSelectDate={selectDate} onManage={() => setModal("connections")} onOpenTask={openTask} />}
            {view === "together" && <><div className="together-view-heading"><h2>서로의 오늘 <span>{data.members.length}명</span></h2></div><div className="person-filters"><button className={person === "all" ? "selected" : ""} onClick={() => setPerson("all")}>모두</button>{data.members.map((member, i) => <button className={person === member.id ? "selected" : ""} key={member.id} onClick={() => setPerson(member.id)}><Avatar name={member.name} index={i} small />{member.name}</button>)}</div>{data.members.filter(member => person === "all" || person === member.id).map((member, i) => {
              const tasks = data.tasks.filter(task => task.ownerId === member.id && dailyTaskItems([task], date).length > 0);
              const items = dailyTaskItems(tasks, date);
              const count = items.filter(task => task.done).length;
              return <section key={member.id} className="card member-card"><div className="member-card-heading"><Avatar name={member.name} index={i} /><div><h3>{member.name}{member.id === data.me.id && <span className="me-label">나</span>}</h3><span>{items.length ? `${items.length - count}개 남음 · ${count}개 완료` : "오늘 할 일 없음"}</span></div><span className="member-percent">{items.length ? Math.round(count / items.length * 100) : 0}<small>%</small></span></div>{tasks.length > 0 && <><div className="task-progress"><span style={{ width: `${items.length ? count / items.length * 100 : 0}%` }} /></div><ul className="task-list">{tasks.map(task => taskRow(task, { readOnly: task.ownerId !== data.me.id }))}</ul></>}</section>;
            })}</>}
          </div>
        </div>)}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <dialog ref={dialog} className="app-dialog" onCancel={() => setModal(null)} aria-labelledby="dialog-title" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="dialog-inner"><div className="dialog-heading"><h2 id="dialog-title">{modal === "connections" ? "나의 프로필과 연결" : modal === "share" ? "사이트 공유" : modal === "task" ? calendarChildId ? "하위 할 일 수정" : "할 일 수정" : "할 일을 삭제할까요?"}</h2><button className="icon-button" aria-label="닫기" onClick={() => setModal(null)}><X size={19} /></button></div>
      {modal === "task" && inspectedTask && <>{error && <p className="error-banner" role="alert">{error}</p>}<ul className="task-list period-task-editor">{taskRow(inspectedTask, { managePeriod: true })}</ul></>}
      {modal === "connections" && <><form className="profile-form" onSubmit={async event => { event.preventDefault(); await mutate({ op: "profile.save", name: nameDraft }, "이름을 저장했어요."); }}><label htmlFor="profile-name">다른 사람에게 보이는 이름</label><div><input id="profile-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} maxLength={40} required /><button className="button secondary compact" disabled={busy}>저장</button></div></form>
        {googleLogin ? <><form method="post" action="/auth/google/calendar">
          <button className="button primary full" type="submit" disabled={busy}>
            <CalendarDays size={15} />{data?.sources.length ? "캘린더 선택·다시 연결" : "Google 캘린더 선택"}
          </button>
        </form>{data?.calendarSync?.some(connection => connection.enabled) && <button className="button secondary full" disabled={busy} onClick={() => void mutate({ op: "calendar.sync" }, "선택한 캘린더를 동기화했어요.")}><RefreshCw size={15} />지금 동기화</button>}</> : <>
          <div className="connection-explainer"><span className="google-calendar-icon">31</span><span>Google Calendar</span><ArrowRight size={14} /><span className="dots-logo"><i /><i /><i /></span><span>dots</span><ArrowRight size={14} /><strong>daylight</strong></div><h3 className="dialog-section-title">마일스톤만 캘린더에서 가져와요</h3><p className="dialog-description">dots에 Google Calendar와 daylight를 연결한 뒤, 아래 요청을 전달하세요. 선택한 캘린더의 일정은 이 공간의 모든 팀원에게 보입니다. 일일 할 일은 직접 작성하고 관리해요.</p><ol className="connection-steps"><li><strong>daylight 앱 연결</strong><span>ChatGPT의 플러그인에서 개인 → 내가 만든 항목 → daylight를 설치하거나 연결하세요.</span><a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">플러그인 열기<ExternalLink size={12} /></a></li><li><strong>dots에 Google Calendar 연결</strong><span>dots의 연결된 앱에서 Google Calendar 사용 권한을 확인하세요.</span></li><li><strong>팀에 공유할 캘린더 지정</strong><label htmlFor="calendar-name">캘린더 이름 또는 ID</label><input id="calendar-name" value={calendarName} onChange={event => setCalendarName(event.target.value)} maxLength={300} placeholder="예: 팀 마일스톤" /></li></ol>{connectionPrompt && <textarea className="copy-prompt" value={connectionPrompt} readOnly rows={5} aria-label="dots에 전달할 요청" />}<button className="button primary full" disabled={!connectionPrompt} onClick={() => void copy(connectionPrompt, "요청을 복사했어요. dots 대화에 붙여넣어주세요.")}><Copy size={15} />dots에 전달할 요청 복사</button><p className="connection-footnote">직접 Google에 로그인하는 방식이 아닌 dots를 통한 동기화예요. 자동 실행은 별도 설정이 필요하며, 현재 예약된 작업은 없습니다.</p>
        </>}
        {!!data?.sources.length && <div className="connected-sources"><h3>마지막으로 가져온 캘린더</h3>{data.sources.map(source => {
          const connection = data.calendarSync?.find(item => item.calendarId === source.calendarId);
          return <div key={`${source.ownerId}:${source.calendarId}`}><strong>{source.name}</strong><span>{source.ownerName} · {syncTime(source.syncedAt)}</span>
            {googleLogin && <span>{connection?.enabled ? connection.error ? "동기화 재시도 중" : "5분마다 자동 동기화" : connection?.error === "reconnect" ? "Google 다시 연결 필요" : "자동 동기화 꺼짐"}</span>}
            {connection?.canManage && <form method="post" action="/auth/google/calendar/disconnect"><input type="hidden" name="calendarId" value={source.calendarId} /><button className="text-button" type="submit">자동 동기화 해제</button></form>}
          </div>;
        })}</div>}
      </>}
      {modal === "share" && <>
        <p className="dialog-description">서로의 할 일과 완료 상태를 볼 수 있어요. 할 일은 본인만 수정하고, 캘린더 일정은 본인에게만 보여요.</p>
        {googleLogin && <>
          {!invitations && !inviteError && <p className="tiny muted" role="status">초대 목록 불러오는 중…</p>}
          {invitations?.canInvite && <form className="profile-form" onSubmit={event => { event.preventDefault(); void invite(); }}>
            <label htmlFor="invite-email">함께할 사람의 Google 이메일</label>
            <div><input id="invite-email" type="email" autoComplete="off" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} maxLength={254} placeholder="name@example.com" required disabled={inviteBusy} /><button className="button primary compact" disabled={inviteBusy || !inviteEmail.trim()}>{inviteBusy ? "추가 중…" : "초대 추가"}</button></div>
          </form>}
          {inviteError && <p role="alert" className="invite-error">{inviteError}</p>}
          {inviteMessage && <p role="status" className="tiny">{inviteMessage}</p>}
          {!!invitations?.invitations.length && <ul className="invite-list" aria-label="초대 목록">{invitations.invitations.map(item => <li key={item.email}><span>{item.email}</span><span className="tiny muted">{item.joined ? "참여함" : "로그인 대기"}</span></li>)}</ul>}
        </>}
        <div className="share-link"><input value={typeof window !== "undefined" ? window.location.origin : ""} readOnly aria-label="사이트 공유 주소" /><button className="button primary compact" onClick={() => void copy(window.location.origin, "공유 링크를 복사했어요.")}><Copy size={14} />링크 복사</button></div>
        <div className="share-privacy"><LockKeyhole size={17} /><p><strong>초대된 계정만 들어올 수 있어요.</strong><span>{googleLogin ? "초대한 이메일의 Google 계정으로 로그인해 주세요." : "접근 권한을 받은 계정으로 로그인해 주세요."}</span></p></div>
        <div className="share-members"><h3>함께하는 사람 <span>{data?.members.length || 0}</span></h3>{data?.members.map((member, i) => <div key={member.id}><Avatar name={member.name} index={i} small /><span>{member.name}</span>{member.id === data.me.id && <span className="me-label">나</span>}</div>)}</div>
      </>}
      {modal === "delete" && <><p className="dialog-description">‘{deleteBacklog?.title ?? deleteChild?.title ?? deleteTask?.title}’을(를) 삭제합니다.{!deleteChild && Boolean(deleteTask?.subtasks.length || deleteTask?.unscheduledCount) && " 하위 할 일도 함께 삭제됩니다."}</p><div className="dialog-buttons"><button className="button secondary" onClick={() => setModal(null)}>취소</button><button className="button danger" disabled={busy} onClick={async () => { const id = deleteBacklog?.id ?? deleteChild?.id ?? deleteTask?.id; if (id && await mutate({ op: deleteBacklog ? "backlog.delete" : deleteChild ? "subtask.delete" : "task.delete", id }, "할 일을 삭제했어요.")) { setModal(null); setDeleteTask(null); setDeleteChild(null); setDeleteBacklog(null); } }}>삭제</button></div></>}
      {modal === "connections" && googleLogin && <form className="dialog-buttons" method="post" action="/auth/google/logout"><button className="button secondary">로그아웃</button></form>}
    </div></dialog>
  </div>;
}
