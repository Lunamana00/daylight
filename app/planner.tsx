"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, ExternalLink, Flag, Leaf, Link2, LoaderCircle, LockKeyhole, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2, Share2, Star, Sun, Sunrise, Trash2, Users, X } from "lucide-react";
import { addDays, today } from "../lib/planner-core";
import type { DayData, Milestone, Task } from "../lib/planner-core";

type View = "mine" | "team" | "milestones";
type Modal = "connections" | "share" | "delete" | null;
const shortDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(date + "T00:00:00Z"));
const longDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
const weekday = (date: string) => new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
const syncTime = (time: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(time));
function Avatar({ name, index = 0, small = false }: { name: string; index?: number; small?: boolean }) {
  return <span className={`avatar color-${index % 5} ${small ? "small" : ""}`} aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>;
}

export default function Planner() {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<DayData | null>(null);
  const [view, setView] = useState<View>("mine");
  const [filter, setFilter] = useState("all");
  const [person, setPerson] = useState("all");
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
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
    setData(null); setNoteDraft(""); setNoteDirty(false); setEditId(null); setMenuId(null);
    void load(date);
  }, [date, load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy) void load(dateRef.current); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [busy, load]);
  useEffect(() => {
    if (data && !noteDirty) setNoteDraft(data.notes.find(note => note.ownerId === data.me.id)?.content || "");
  }, [data, noteDirty]);
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
    if (noteDirty && !window.confirm("저장하지 않은 오늘의 한 줄이 있어요. 날짜를 바꿀까요?")) return;
    setDate(value);
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setToast(message); }
    catch { setError("복사하지 못했어요. 아래 내용을 직접 선택해 복사해주세요."); }
  }
  function addFocus() { setView("mine"); setTimeout(() => taskInput.current?.focus(), 0); }
  const myTasks = data?.tasks.filter(task => task.ownerId === data.me.id) || [];
  const completed = myTasks.filter(task => task.done).length;
  const teamCompleted = data?.tasks.filter(task => task.done).length || 0;
  const ownFiltered = myTasks.filter(task => filter === "all" || (filter === "done" ? task.done : !task.done));
  const mondayOffset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monday = addDays(date, -mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const closest = data?.milestones[0];
  const daysUntil = (value: string) => Math.round((Date.parse(value) - Date.parse(date)) / 86_400_000);
  const badge = (value: string) => daysUntil(value) === 0 ? "D-DAY" : `D-${daysUntil(value)}`;
  const connectionPrompt = calendarName.trim() ? `daylight 사이트 ${typeof window !== "undefined" ? window.location.origin : ""}의 연결된 도구를 사용해줘. Google Calendar에서 내가 팀에 공유할 마일스톤용으로 지정하는 캘린더 ${JSON.stringify(calendarName.trim())}만 읽어서, 한국 시간 오늘부터 90일 뒤까지의 마일스톤을 daylight에 동기화해줘. 페이지가 여러 개면 끝까지 읽고 성공한 뒤에만 sync_google_calendar_milestones를 호출해. 이 캘린더 일정이 사이트의 모든 팀원에게 공유되는 것을 허용해. 일정의 원래 ID와 제목을 유지하고, 종일 일정은 start.date, 시간 일정은 한국 시간 시작 날짜를 사용해. Google 캘린더에는 아무것도 쓰지 마. 내가 직접 작성한 일일 할 일은 get_daily_plan으로 읽기만 하고 추가·수정·완료 처리하지 마. 자동 실행은 아직 설정하지 마.` : "";

  function milestoneItem(item: Milestone, expanded = false) {
    return <div className={`milestone-item ${expanded ? "expanded" : ""}`} key={`${item.ownerId}:${item.calendarId}:${item.eventId}`}>
      <div className="milestone-point"><Flag size={14} /></div>
      <div className="milestone-info"><span className="tiny muted">{shortDate(item.date)} · {weekday(item.date)}요일</span><h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={12} /></a> : item.title}</h3><span className="tiny muted">{item.sourceName}{expanded ? ` · ${item.ownerName} 님이 연결` : ""}</span></div>
      <span className={`due-tag ${daysUntil(item.date) <= 7 ? "near" : ""}`}>{badge(item.date)}</span>
    </div>;
  }
  function taskRow(task: Task, readOnly = false) {
    return <li className={`task-row ${task.done ? "is-done" : ""}`} key={task.id}>
      <button className={`task-check ${task.done ? "checked" : ""}`} disabled={busy || readOnly} onClick={() => void mutate({ op: "task.patch", id: task.id, done: !task.done })} aria-label={`${task.title} ${task.done ? "완료 취소" : "완료"}`}>{task.done ? <Check size={13} strokeWidth={3} /> : null}</button>
      {editId === task.id && !readOnly ? <form className="inline-edit" onSubmit={async event => { event.preventDefault(); if (await mutate({ op: "task.patch", id: task.id, title: editTitle })) setEditId(null); }}><input autoFocus value={editTitle} onChange={event => setEditTitle(event.target.value)} maxLength={240} aria-label="할 일 수정" onKeyDown={event => { if (event.key === "Escape") setEditId(null); }} /><button className="text-button" disabled={busy}>저장</button><button type="button" className="icon-button" aria-label="수정 취소" onClick={() => setEditId(null)}><X size={14} /></button></form> : <span className="task-title">{task.title}</span>}
      {task.important && readOnly ? <Star size={14} className="starred" /> : null}
      {!readOnly && editId !== task.id && <div className="task-actions"><button className={`icon-button star-button ${task.important ? "starred" : ""}`} title={task.important ? "중요 표시 해제" : "중요 표시"} aria-label={`${task.title} 중요 표시 ${task.important ? "해제" : "설정"}`} disabled={busy} onClick={() => void mutate({ op: "task.patch", id: task.id, important: !task.important })}><Star size={15} /></button><div className="task-menu-anchor"><button className="icon-button" aria-label={`${task.title} 메뉴`} aria-expanded={menuId === task.id} onClick={() => setMenuId(menuId === task.id ? null : task.id)}><MoreHorizontal size={18} /></button>{menuId === task.id && <div className="task-menu"><button onClick={() => { setEditId(task.id); setEditTitle(task.title); setMenuId(null); }}><Pencil size={13} />수정</button><button disabled={busy || date >= "2100-09-01"} onClick={async () => { if (await mutate({ op: "task.patch", id: task.id, date: addDays(date, 1), done: false }, "다음 날 할 일로 옮겼어요.")) setMenuId(null); }}><ArrowRight size={13} />다음 날로 옮기기</button><button className="danger-text" onClick={() => { setDeleteTask(task); setModal("delete"); setMenuId(null); }}><Trash2 size={13} />삭제</button></div>}</div></div>}
    </li>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => { setView("mine"); selectDate(today()); }} aria-label="daylight 오늘로"><Sun className="brand-sun" size={31} strokeWidth={1.65} /><span>daylight<span className="brand-period">.</span></span></button>
      <div className="workspace-label"><span className="workspace-icon"><Leaf size={15} /></span><div><strong>우리의 워크스페이스</strong><span>오늘을 가볍게, 함께</span></div></div>
      <span className="nav-caption">DAILY SPACE</span>
      <nav aria-label="주 메뉴"><button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}><Sunrise size={18} />나의 하루<span className="nav-count">{myTasks.filter(t => !t.done).length}</span></button><button className={view === "team" ? "active" : ""} onClick={() => { setView("team"); setPerson("all"); }}><Users size={18} />함께하는 오늘</button><button className={view === "milestones" ? "active" : ""} onClick={() => setView("milestones")}><Flag size={18} />마일스톤</button></nav>
      <div className="members-label"><span className="nav-caption">MEMBERS</span><span className="tiny muted">{data?.members.length || 0}</span></div>
      <div className="member-list">{data?.members.map((member, i) => <button key={member.id} onClick={() => { setView("team"); setPerson(member.id); }}><Avatar name={member.name} index={i} small /><span>{member.name}</span>{member.id === data.me.id && <span className="me-label">나</span>}<span className="member-dot" /></button>)}</div>
      <button className="invite-sidebar" onClick={() => setModal("share")}><Plus size={15} />함께할 사람 초대</button>
      <div className="sidebar-bottom"><button className="dots-connect" onClick={() => setModal("connections")}><span className="dots-logo"><i /><i /><i /></span><div><strong>OpenAI dots</strong><span>{data?.sources.length ? "마일스톤 동기화 관리" : "하루의 맥락을 연결하세요"}</span></div><ArrowRight size={15} /></button><button className="sidebar-settings" onClick={() => setModal("connections")}><Settings2 size={16} />연결 및 내 프로필</button><span className="sidebar-footer">작은 하루들이 모여, 큰 진전으로.</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>워크스페이스</span><ChevronRight size={13} /><strong>{view === "mine" ? "나의 하루" : view === "team" ? "함께하는 오늘" : "마일스톤"}</strong></div><div className="topbar-actions"><span className="private-badge"><LockKeyhole size={12} />초대한 멤버만</span><button className="button secondary compact" onClick={() => setModal("share")}><Share2 size={14} />공유</button><button className="profile-button" onClick={() => setModal("connections")} aria-label="내 프로필"><Avatar name={data?.me.name || "나"} small /></button></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow"><span className="live-dot" /> A LITTLE PROGRESS, EVERY DAY</p><h1>{view === "mine" ? <>오늘도, 한 걸음씩<span className="heading-dot">.</span></> : view === "team" ? <>각자의 하루, 함께<span className="heading-dot">.</span></> : <>우리가 향하는 곳<span className="heading-dot">.</span></>}</h1><p className="page-description">{view === "mine" ? "큰 목표는 마음에 두고, 오늘 할 만큼만 정리해요." : view === "team" ? "서로의 계획과 작은 진전을 한눈에 확인해요." : "구글 캘린더의 중요한 마감과 목표를 모아 봐요."}</p></div><button className="button primary add-top" onClick={addFocus} disabled={!data}><Plus size={17} />할 일 추가</button></div>
        <div className="date-toolbar"><div className="date-title"><CalendarDays size={17} /><strong>{longDate(date)}</strong>{date === today() && <span className="today-tag">오늘</span>}</div><div className="date-controls"><button className="text-button" onClick={() => selectDate(today())} disabled={busy}>오늘로</button><label className="date-picker"><CalendarDays size={15} /><input type="date" value={date} min="2000-01-01" max="2100-09-01" onChange={event => selectDate(event.target.value)} disabled={busy} aria-label="날짜 선택" /></label><button className={`icon-button ${refreshing ? "rotating" : ""}`} onClick={() => void load(date, true)} disabled={refreshing || busy} aria-label="새로고침"><RefreshCw size={15} /></button></div></div>
        {error && <div className="error-banner" role="alert"><span>{error}{data ? " 마지막으로 불러온 내용을 표시하고 있어요." : ""}</span><button onClick={() => void load(date, true)}>다시 시도</button></div>}
        <div className="week-strip"><button className="icon-button week-arrow" aria-label="지난주" onClick={() => selectDate(addDays(date, -7))} disabled={busy || date < "2000-01-08"}><ChevronLeft size={17} /></button>{week.map(value => <button key={value} className={`week-day ${value === date ? "selected" : ""} ${value === today() ? "actual-today" : ""}`} disabled={busy} onClick={() => selectDate(value)} aria-pressed={value === date}><span>{weekday(value)}</span><strong>{Number(value.slice(-2))}</strong><i /></button>)}<button className="icon-button week-arrow" aria-label="다음주" onClick={() => selectDate(addDays(date, 7))} disabled={busy || date > "2100-08-25"}><ChevronRight size={17} /></button></div>
        {!data ? <div className="loading-state" role="status">{error ? <><Leaf size={27} /><p>다시 연결하면 계획을 볼 수 있어요.</p></> : <><LoaderCircle size={23} className="spin" /><p>우리의 하루를 불러오고 있어요.</p></>}</div> : <div className={`content-grid ${view === "milestones" ? "milestones-layout" : ""}`}>
          <div className="primary-column">
            {view === "mine" && <>
              <section className="focus-card"><div className="focus-heading"><span className="focus-icon"><Sunrise size={20} /></span><div><h2>오늘의 한 줄</h2><span>오늘 가장 마음을 쓸 일은 무엇인가요?</span></div><span className="shared-note-label"><Users size={12} />팀에 공유</span></div><form onSubmit={async event => { event.preventDefault(); if (await mutate({ op: "note.save", date, content: noteDraft }, "오늘의 한 줄을 저장했어요.")) setNoteDirty(false); }}><textarea value={noteDraft} onChange={event => { setNoteDraft(event.target.value); setNoteDirty(true); }} maxLength={500} rows={2} placeholder="하루의 방향을 한 줄로 적어보세요." aria-label="오늘의 한 줄" /><div className="focus-footer"><span>{noteDirty ? "아직 저장하지 않은 내용이에요" : noteDraft ? "저장된 내용 · 팀원과 함께 볼 수 있어요" : "작은 계획 하나로 시작해도 좋아요"}</span><button className="text-button" disabled={busy || !noteDirty}>{busy && noteDirty ? "저장 중…" : "저장"}<ArrowRight size={13} /></button></div></form></section>
              <section className="card tasks-card"><div className="section-heading"><div className="section-title"><h2>내가 정한 오늘의 할 일</h2><span className="count-pill">{myTasks.length}</span></div><span className="completion-label"><strong>{completed}</strong> / {myTasks.length} 완료</span></div><div className="task-progress"><span style={{ width: `${myTasks.length ? completed / myTasks.length * 100 : 0}%` }} /></div><div className="task-filter" aria-label="할 일 필터">{[["all", "전체"], ["open", "할 일"], ["done", "완료"]].map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}{key === "done" && <span>{completed}</span>}</button>)}</div>
                {ownFiltered.length ? <ul className="task-list">{ownFiltered.map(task => taskRow(task))}</ul> : <div className="empty-tasks"><span className="empty-illustration"><CheckCheck size={29} strokeWidth={1.4} /></span><h3>{myTasks.length ? filter === "done" ? "아직 완료한 일이 없어요" : "정한 일을 모두 마쳤어요" : "오늘은 무엇을 해볼까요?"}</h3><p>{myTasks.length ? filter === "done" ? "하나씩 마칠 때마다 여기에 쌓일 거예요." : "작은 진전도 충분히 의미 있는 하루예요." : "할 일을 직접 적고, 하나씩 가볍게 체크해요."}</p></div>}
                <form className="task-composer" onSubmit={async event => { event.preventDefault(); if (await mutate({ op: "task.add", date, title: draft })) { setDraft(""); setFilter("all"); taskInput.current?.focus(); } }}><Plus size={18} /><input ref={taskInput} value={draft} onChange={event => setDraft(event.target.value)} maxLength={240} placeholder="오늘 할 일 추가하기" aria-label="새 할 일" disabled={busy} /><button aria-label="할 일 추가" disabled={busy || !draft.trim()}><ArrowRight size={17} /></button></form><div className="task-card-footer"><span><Star size={12} />별표로 중요한 일을 표시하세요</span><span>직접 계획하는 하루</span></div>
              </section>
              <button className="team-peek card" onClick={() => { setView("team"); setPerson("all"); }}><span className="team-peek-icon"><Users size={21} /></span><div><strong>팀원들은 어떤 하루를 보내고 있을까요?</strong><span>{data.members.length}명의 계획 · 오늘 {teamCompleted}개 완료</span></div><ArrowRight size={18} /></button>
            </>}
            {view === "team" && <><div className="team-view-heading"><div><h2>함께하는 오늘 <span>{data.members.length}</span></h2><p>팀원의 할 일은 읽기만 할 수 있어요.</p></div><div className="team-totals"><CheckCheck size={16} /><strong>{teamCompleted}</strong><span>/ {data.tasks.length} 완료</span></div></div><div className="person-filters"><button className={person === "all" ? "selected" : ""} onClick={() => setPerson("all")}>모두</button>{data.members.map((member, i) => <button className={person === member.id ? "selected" : ""} key={member.id} onClick={() => setPerson(member.id)}><Avatar name={member.name} index={i} small />{member.name}</button>)}</div>{data.members.filter(member => person === "all" || person === member.id).map((member, i) => {
              const tasks = data.tasks.filter(task => task.ownerId === member.id);
              const count = tasks.filter(task => task.done).length;
              const note = data.notes.find(value => value.ownerId === member.id)?.content;
              return <section key={member.id} className="card member-card"><div className="member-card-heading"><Avatar name={member.name} index={i} /><div><h3>{member.name}{member.id === data.me.id && <span className="me-label">나</span>}</h3><span>{tasks.length ? `${tasks.length - count}개의 할 일 · ${count}개 완료` : "아직 오늘의 계획을 적지 않았어요"}</span></div><span className="member-percent">{tasks.length ? Math.round(count / tasks.length * 100) : 0}<small>%</small></span></div>{note && <p className="member-focus"><Sunrise size={14} />{note}</p>}<div className="task-progress"><span style={{ width: `${tasks.length ? count / tasks.length * 100 : 0}%` }} /></div>{tasks.length ? <ul className="task-list">{tasks.map(task => taskRow(task, task.ownerId !== data.me.id))}</ul> : <p className="member-empty">각자의 속도로 하루를 준비하고 있어요.</p>}</section>;
            })}<p className="team-refresh-note"><RefreshCw size={12} />열려 있는 동안 30초마다 새 내용을 확인해요.</p></>}
            {view === "milestones" && <section className="card full-milestones"><div className="section-heading"><div className="section-title"><Flag size={18} /><h2>다가오는 마일스톤</h2><span className="count-pill">{data.milestones.length}</span></div><span className="tiny muted">선택한 날부터 90일</span></div><p className="milestone-intro">큰 목표와 마감은 이곳에, 실행할 일은 각자의 하루에.</p>{data.milestones.length ? data.milestones.map(item => milestoneItem(item, true)) : <div className="empty-milestones"><Flag size={34} strokeWidth={1.4} /><h3>{data.sources.length ? "이 기간에 등록된 마일스톤이 없어요" : "큰 목표를 연결해보세요"}</h3><p>{data.sources.length ? "마지막 동기화 시점의 캘린더를 표시하고 있어요." : "dots를 통해 선택한 구글 캘린더를 불러올 수 있어요."}</p><button className="button secondary" onClick={() => setModal("connections")}><Link2 size={14} />연결 관리</button></div>}</section>}
          </div>
          <aside className="right-column">
            <section className="card milestones-card"><div className="section-heading"><div className="section-title"><Flag size={16} /><h2>다가오는 마일스톤</h2></div><button className="icon-button" aria-label="전체 마일스톤 보기" onClick={() => setView("milestones")}><ArrowRight size={16} /></button></div><div className="source-label"><span className="google-calendar-icon">31</span>Google Calendar<span className={`source-state ${data.sources.length ? "connected" : ""}`}>{data.sources.length ? "가져온 일정" : "연결 전"}</span></div>{data.milestones.length ? data.milestones.slice(0, 4).map(item => milestoneItem(item)) : <div className="milestones-mini-empty"><div className="calendar-drawing"><span /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><p>{data.sources.length ? "예정된 마일스톤이 없어요" : "중요한 목표를 한눈에"}</p><span>{data.sources.length ? "마지막으로 가져온 일정 기준이에요." : "마감과 목표를 캘린더에서 가져와요."}</span>{!data.sources.length && <button className="text-button" onClick={() => setModal("connections")}>캘린더 연결하기<ArrowRight size={13} /></button>}</div>}<div className="milestone-card-footer"><RefreshCw size={11} /><span>{data.sources.length ? `최근 동기화 ${syncTime(data.sources[0].syncedAt)}` : "dots를 통해 동기화해요"}</span></div></section>
            <section className="day-note"><span className="day-note-sun"><Sun size={30} strokeWidth={1.15} /></span><p>{closest ? <>다음 목표까지 <strong>{daysUntil(closest.date) === 0 ? "바로 오늘" : `${daysUntil(closest.date)}일`}.</strong><br />오늘의 작은 일부터.</> : <>많이 하는 하루보다,<br /><strong>하나라도 나아가는 하루.</strong></>}</p><span>MAKE ROOM FOR WHAT MATTERS</span></section>
            <section className="how-card"><h3>우리의 하루를 쓰는 법</h3><div><span>01</span><p>아침에 오늘 할 일을 적어요.</p></div><div><span>02</span><p>마친 일은 체크하고 공유해요.</p></div><div><span>03</span><p>팀의 진전과 큰 목표를 살펴봐요.</p></div></section>
          </aside>
        </div>}
        <footer className="main-footer"><span>조금씩, 꾸준히, 함께.</span><span>daylight · Asia/Seoul</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <dialog ref={dialog} className="app-dialog" onCancel={() => setModal(null)} aria-labelledby="dialog-title" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="dialog-inner"><div className="dialog-heading"><h2 id="dialog-title">{modal === "connections" ? "나의 프로필과 연결" : modal === "share" ? "함께 쓰는 daylight" : "할 일을 삭제할까요?"}</h2><button className="icon-button" aria-label="닫기" onClick={() => setModal(null)}><X size={19} /></button></div>
      {modal === "connections" && <><form className="profile-form" onSubmit={async event => { event.preventDefault(); await mutate({ op: "profile.save", name: nameDraft }, "이름을 저장했어요."); }}><label htmlFor="profile-name">팀에 보이는 내 이름</label><div><input id="profile-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} maxLength={40} required /><button className="button secondary compact" disabled={busy}>저장</button></div></form><div className="connection-explainer"><span className="google-calendar-icon">31</span><span>Google Calendar</span><ArrowRight size={14} /><span className="dots-logo"><i /><i /><i /></span><span>dots</span><ArrowRight size={14} /><strong>daylight</strong></div><h3 className="dialog-section-title">마일스톤만 캘린더에서 가져와요</h3><p className="dialog-description">dots에 Google Calendar와 daylight를 연결한 뒤, 아래 요청을 전달하세요. 선택한 캘린더의 일정은 이 공간의 모든 팀원에게 보입니다. 일일 할 일은 직접 작성하고 관리해요.</p><ol className="connection-steps"><li><strong>daylight 앱 연결</strong><span>ChatGPT의 플러그인에서 개인 → 내가 만든 항목 → daylight를 설치하거나 연결하세요.</span><a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">플러그인 열기<ExternalLink size={12} /></a></li><li><strong>dots에 Google Calendar 연결</strong><span>dots의 연결된 앱에서 Google Calendar 사용 권한을 확인하세요.</span></li><li><strong>팀에 공유할 캘린더 지정</strong><label htmlFor="calendar-name">캘린더 이름 또는 ID</label><input id="calendar-name" value={calendarName} onChange={event => setCalendarName(event.target.value)} maxLength={300} placeholder="예: 팀 마일스톤" /></li></ol>{connectionPrompt && <textarea className="copy-prompt" value={connectionPrompt} readOnly rows={5} aria-label="dots에 전달할 요청" />}<button className="button primary full" disabled={!connectionPrompt} onClick={() => void copy(connectionPrompt, "요청을 복사했어요. dots 대화에 붙여넣어주세요.")}><Copy size={15} />dots에 전달할 요청 복사</button><p className="connection-footnote">직접 Google에 로그인하는 방식이 아닌 dots를 통한 동기화예요. 자동 실행은 별도 설정이 필요하며, 현재 예약된 작업은 없습니다.</p>{!!data?.sources.length && <div className="connected-sources"><h3>마지막으로 가져온 캘린더</h3>{data.sources.map(source => <div key={`${source.ownerId}:${source.calendarId}`}><strong>{source.name}</strong><span>{source.ownerName} · {syncTime(source.syncedAt)}</span></div>)}</div>}</>}
      {modal === "share" && <><div className="share-visual"><Users size={31} strokeWidth={1.5} /></div><p className="share-headline">각자의 할 일과 진전을, 한곳에서.</p><p className="dialog-description">초대된 팀원은 서로의 일일 할 일, 오늘의 한 줄, 공통 마일스톤을 볼 수 있어요. 할 일과 한 줄은 본인만 수정할 수 있습니다.</p><div className="share-link"><input value={typeof window !== "undefined" ? window.location.origin : ""} readOnly aria-label="사이트 공유 주소" /><button className="button primary compact" onClick={() => void copy(window.location.origin, "공유 링크를 복사했어요.")}><Copy size={14} />복사</button></div><div className="share-privacy"><LockKeyhole size={17} /><p><strong>접근 권한을 받은 계정만 들어올 수 있어요.</strong><span>추가할 팀원의 이메일을 이 사이트를 만든 Codex 대화에 알려주세요. 초대가 적용된 뒤 같은 계정으로 로그인하면 함께 사용할 수 있어요.</span></p></div><div className="share-members"><h3>참여한 멤버 <span>{data?.members.length || 0}</span></h3>{data?.members.map((member, i) => <div key={member.id}><Avatar name={member.name} index={i} small /><span>{member.name}</span>{member.id === data.me.id && <span className="me-label">나</span>}</div>)}</div></>}
      {modal === "delete" && <><p className="dialog-description">‘{deleteTask?.title}’을(를) 목록에서 삭제합니다.</p><div className="dialog-buttons"><button className="button secondary" onClick={() => setModal(null)}>취소</button><button className="button danger" disabled={busy} onClick={async () => { if (deleteTask && await mutate({ op: "task.delete", id: deleteTask.id }, "할 일을 삭제했어요.")) { setModal(null); setDeleteTask(null); } }}>삭제</button></div></>}
    </div></dialog>
  </div>;
}
