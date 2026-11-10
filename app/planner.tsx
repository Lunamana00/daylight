"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, LoaderCircle, LockKeyhole, RefreshCw, Settings2, Share2, Sun, Sunrise, Users, X } from "lucide-react";
import { addDays, dailyTaskItems, today } from "../lib/planner-core";
import type { DayData, Subtask, Task } from "../lib/planner-core";
import { PlannerCalendar } from "../components/planner-calendar";
import { PlannerTask } from "../components/planner-task";
import { WorkLog } from "../components/work-log";

type View = "mine" | "together" | "work";
type Modal = "connections" | "share" | "delete" | null;
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
  const [view, setView] = useState<View>("together");
  const [workTask, setWorkTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState("all");
  const [person, setPerson] = useState("all");
  const [draft, setDraft] = useState("");
  const [multipleDays, setMultipleDays] = useState(false);
  const [periodStart, setPeriodStart] = useState(date);
  const [periodEnd, setPeriodEnd] = useState(addDays(date, 1));
  const [nameDraft, setNameDraft] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitations, setInvitations] = useState<Invitations | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [deleteChild, setDeleteChild] = useState<Subtask | null>(null);
  const dateRef = useRef(date);
  const sequence = useRef(0);
  const taskInput = useRef<HTMLInputElement>(null);
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
    setPeriodStart(date); setPeriodEnd(date < "2100-09-01" ? addDays(date, 1) : date);
    void load(date);
  }, [date, load, view]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy) void load(dateRef.current); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [busy, load]);
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
      const response = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, viewDate: targetDate }) });
      const value = await response.json() as DayData & { error?: string };
      if (!response.ok) throw new Error(value.error || "변경 사항을 저장하지 못했어요.");
      if (dateRef.current === targetDate) setData(value);
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
  const myTasks = data?.tasks.filter(task => task.ownerId === data.me.id) || [];
  const dailyItems = dailyTaskItems(myTasks, date);
  const completed = dailyItems.filter(task => task.done).length;
  const ownFiltered = myTasks.filter(task => filter === "all" || dailyTaskItems([task], date).some(item => filter === "done" ? item.done : !item.done));
  const mondayOffset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monday = addDays(date, -mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const connectionPrompt = calendarName.trim() ? `daylight 사이트 ${typeof window !== "undefined" ? window.location.origin : ""}의 연결된 도구를 사용해줘. Google Calendar에서 내가 팀에 공유할 마일스톤용으로 지정하는 캘린더 ${JSON.stringify(calendarName.trim())}만 읽어서, 한국 시간 오늘부터 90일 뒤까지의 마일스톤을 daylight에 동기화해줘. 페이지가 여러 개면 끝까지 읽고 성공한 뒤에만 sync_google_calendar_milestones를 호출해. 이 캘린더 일정이 사이트의 모든 팀원에게 공유되는 것을 허용해. 일정의 원래 ID와 제목을 유지하고, 종일 일정은 start.date, 시간 일정은 한국 시간 시작 날짜를 사용해. Google 캘린더에는 아무것도 쓰지 마. 내가 직접 작성한 일일 할 일은 get_daily_plan으로 읽기만 하고 추가·수정·완료 처리하지 마. 자동 실행은 아직 설정하지 마.` : "";

  function taskRow(task: Task, readOnly = false) {
    return <PlannerTask key={`${date}-${task.id}`} task={task} date={date} busy={busy} readOnly={readOnly} onChange={mutate} onOpenWorkLog={readOnly ? undefined : task => { setWorkTask(task); setView("work"); }} onDelete={(parent, child) => { setDeleteTask(parent); setDeleteChild(child ?? null); setModal("delete"); }} />;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="sidebar-brand" aria-label="daylight 오늘로" onClick={() => { setView("together"); selectDate(today()); }}>
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
            {view === "mine" && (data.date === date ? <section className="card tasks-card">
              <div className="section-heading">
                <div className="section-title"><h2>{shortDate(date)} 내 할 일</h2></div>
                <span className="completion-label"><strong>{completed}</strong> / {dailyItems.length} 완료</span>
              </div>
              <div className="task-progress"><span style={{ width: `${dailyItems.length ? completed / dailyItems.length * 100 : 0}%` }} /></div>
              <form className="task-composer" onSubmit={async event => {
                event.preventDefault();
                if (await mutate({ op: "task.add", date: multipleDays ? periodStart : date, endDate: multipleDays ? periodEnd : null, title: draft })) {
                  setDraft("");
                  setFilter("all");
                  if (multipleDays) selectDate(periodStart);
                  taskInput.current?.focus();
                }
              }}>
                <input ref={taskInput} value={draft} onChange={event => setDraft(event.target.value)} maxLength={240} placeholder="새 할 일" aria-label="새 할 일" disabled={busy} />
                <button type="button" className="period-toggle" aria-pressed={multipleDays} disabled={busy} onClick={() => setMultipleDays(!multipleDays)}>여러 날</button>
                <button aria-label="할 일 추가" disabled={busy || !draft.trim()}>추가</button>
                {multipleDays && <div className="task-period-fields">
                  <label>시작일<input type="date" value={periodStart} min="2000-01-01" max="2100-09-01" required disabled={busy} onChange={event => setPeriodStart(event.target.value)} /></label>
                  <span>—</span><label>종료일<input type="date" value={periodEnd} min={periodStart} max="2100-09-01" required disabled={busy} onChange={event => setPeriodEnd(event.target.value)} /></label>
                </div>}
              </form>
              <div className="task-filter" aria-label="할 일 필터">{[["all", "전체"], ["open", "할 일"], ["done", "완료"]].map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}{key === "done" && <span>{completed}</span>}</button>)}</div>
              {ownFiltered.length ? <ul className="task-list">{ownFiltered.map(task => taskRow(task))}</ul> : <p className="empty-tasks">{myTasks.length ? filter === "done" ? "완료한 할 일 없음" : "남은 할 일 없음" : "할 일 없음"}</p>}
            </section> : <p className="calendar-status" role="status">{error ? "이 날짜의 할 일을 불러오지 못했어요." : "할 일 불러오는 중…"}</p>)}
            {view === "mine" && <PlannerCalendar date={date} data={data} busy={busy} onChange={mutate} onSelectDate={selectDate} onManage={() => setModal("connections")} />}
            {view === "together" && <><div className="together-view-heading"><h2>서로의 오늘 <span>{data.members.length}명</span></h2></div><div className="person-filters"><button className={person === "all" ? "selected" : ""} onClick={() => setPerson("all")}>모두</button>{data.members.map((member, i) => <button className={person === member.id ? "selected" : ""} key={member.id} onClick={() => setPerson(member.id)}><Avatar name={member.name} index={i} small />{member.name}</button>)}</div>{data.members.filter(member => person === "all" || person === member.id).map((member, i) => {
              const tasks = data.tasks.filter(task => task.ownerId === member.id);
              const items = dailyTaskItems(tasks, date);
              const count = items.filter(task => task.done).length;
              return <section key={member.id} className="card member-card"><div className="member-card-heading"><Avatar name={member.name} index={i} /><div><h3>{member.name}{member.id === data.me.id && <span className="me-label">나</span>}</h3><span>{items.length ? `${items.length - count}개 남음 · ${count}개 완료` : "오늘 할 일 없음"}</span></div><span className="member-percent">{items.length ? Math.round(count / items.length * 100) : 0}<small>%</small></span></div>{tasks.length > 0 && <><div className="task-progress"><span style={{ width: `${items.length ? count / items.length * 100 : 0}%` }} /></div><ul className="task-list">{tasks.map(task => taskRow(task, task.ownerId !== data.me.id))}</ul></>}</section>;
            })}</>}
          </div>
        </div>)}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <dialog ref={dialog} className="app-dialog" onCancel={() => setModal(null)} aria-labelledby="dialog-title" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="dialog-inner"><div className="dialog-heading"><h2 id="dialog-title">{modal === "connections" ? "나의 프로필과 연결" : modal === "share" ? "사이트 공유" : "할 일을 삭제할까요?"}</h2><button className="icon-button" aria-label="닫기" onClick={() => setModal(null)}><X size={19} /></button></div>
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
      {modal === "delete" && <><p className="dialog-description">‘{deleteChild?.title ?? deleteTask?.title}’을(를) 삭제합니다.{!deleteChild && !!deleteTask?.subtasks.length && " 하위 할 일도 함께 삭제됩니다."}</p><div className="dialog-buttons"><button className="button secondary" onClick={() => setModal(null)}>취소</button><button className="button danger" disabled={busy} onClick={async () => { if (deleteTask && await mutate({ op: deleteChild ? "subtask.delete" : "task.delete", id: deleteChild?.id ?? deleteTask.id }, "할 일을 삭제했어요.")) { setModal(null); setDeleteTask(null); setDeleteChild(null); } }}>삭제</button></div></>}
      {modal === "connections" && googleLogin && <form className="dialog-buttons" method="post" action="/auth/google/logout"><button className="button secondary">로그아웃</button></form>}
    </div></dialog>
  </div>;
}
