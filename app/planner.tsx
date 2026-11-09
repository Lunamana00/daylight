"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, ExternalLink, Flag, GripVertical, Link2, LoaderCircle, LockKeyhole, MoreHorizontal, Pencil, RefreshCw, Settings2, Share2, Star, Sunrise, Trash2, Users, X } from "lucide-react";
import { addDays, milestoneKey, today } from "../lib/planner-core";
import type { DayData, Milestone, Task } from "../lib/planner-core";

type View = "mine" | "team" | "milestones";
type Modal = "connections" | "share" | "delete" | null;
type MilestoneDrag = { key: string; pointerId: number; container: HTMLElement; originalOrder: string[]; items: Milestone[] };
function moveMilestone(items: Milestone[], from: number, to: number) {
  const moved = [...items];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved;
}
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
  const [milestonePreview, setMilestonePreview] = useState<Milestone[] | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const milestoneDrag = useRef<MilestoneDrag | null>(null);
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
    setData(null); setEditId(null); setMenuId(null);
    void load(date);
  }, [date, load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy && !milestoneDrag.current) void load(dateRef.current); };
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
    if (!draggingKey) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") cancelMilestoneDrag(); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [draggingKey]);

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
    if (busy || milestoneDrag.current || !value || value < "2000-01-01" || value > "2100-09-01") return;
    setDate(value);
  }
  async function saveMilestoneOrder(items: Milestone[]) {
    setMilestonePreview(items);
    await mutate({ op: "milestones.reorder", date, order: items.map(({ calendarId, eventId }) => ({ calendarId, eventId })) }, "마일스톤 순서를 저장했어요.");
    setMilestonePreview(null);
  }
  function beginMilestoneDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Milestone) {
    const items = milestonePreview ?? data?.milestones ?? [];
    if (!event.isPrimary || event.button !== 0 || busy || refreshing || milestoneDrag.current || items.length < 2) return;
    const container = event.currentTarget.closest("section")!;
    event.preventDefault();
    event.currentTarget.focus();
    milestoneDrag.current = { key: milestoneKey(item), pointerId: event.pointerId, container, originalOrder: items.map(milestoneKey), items };
    container.setPointerCapture(event.pointerId);
    setDraggingKey(milestoneKey(item));
    setMilestonePreview(items);
  }
  function moveMilestoneDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = milestoneDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (event.clientY > window.innerHeight - 50) window.scrollBy(0, 20);
    else if (event.clientY < 50) window.scrollBy(0, -20);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-milestone-key]");
    if (!target || !event.currentTarget.contains(target)) return;
    const from = drag.items.findIndex(item => milestoneKey(item) === drag.key);
    const to = drag.items.findIndex(item => milestoneKey(item) === target.dataset.milestoneKey);
    if (from < 0 || to < 0 || from === to) return;
    drag.items = moveMilestone(drag.items, from, to);
    setMilestonePreview(drag.items);
  }
  function cancelMilestoneDrag() {
    const drag = milestoneDrag.current;
    if (!drag) return;
    milestoneDrag.current = null;
    setDraggingKey(null);
    setMilestonePreview(null);
    if (drag.container.hasPointerCapture(drag.pointerId)) drag.container.releasePointerCapture(drag.pointerId);
  }
  async function endMilestoneDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = milestoneDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    milestoneDrag.current = null;
    setDraggingKey(null);
    if (drag.container.hasPointerCapture(drag.pointerId)) drag.container.releasePointerCapture(drag.pointerId);
    if (drag.items.every((item, index) => milestoneKey(item) === drag.originalOrder[index])) { setMilestonePreview(null); return; }
    await saveMilestoneOrder(drag.items);
  }
  async function milestoneKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, item: Milestone) {
    if (event.key === "Escape") { event.preventDefault(); cancelMilestoneDrag(); return; }
    if (busy || milestoneDrag.current || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const items = milestonePreview ?? data?.milestones ?? [];
    const from = items.findIndex(value => milestoneKey(value) === milestoneKey(item));
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= items.length) return;
    const handle = event.currentTarget;
    await saveMilestoneOrder(moveMilestone(items, from, to));
    requestAnimationFrame(() => handle.focus());
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setToast(message); }
    catch { setError("복사하지 못했어요. 아래 내용을 직접 선택해 복사해주세요."); }
  }
  const myTasks = data?.tasks.filter(task => task.ownerId === data.me.id) || [];
  const completed = myTasks.filter(task => task.done).length;
  const teamCompleted = data?.tasks.filter(task => task.done).length || 0;
  const ownFiltered = myTasks.filter(task => filter === "all" || (filter === "done" ? task.done : !task.done));
  const mondayOffset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monday = addDays(date, -mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const visibleMilestones = milestonePreview ?? data?.milestones ?? [];
  const daysUntil = (value: string) => Math.round((Date.parse(value) - Date.parse(date)) / 86_400_000);
  const badge = (value: string) => daysUntil(value) === 0 ? "D-DAY" : `D-${daysUntil(value)}`;
  const connectionPrompt = calendarName.trim() ? `daylight 사이트 ${typeof window !== "undefined" ? window.location.origin : ""}의 연결된 도구를 사용해줘. Google Calendar에서 내가 팀에 공유할 마일스톤용으로 지정하는 캘린더 ${JSON.stringify(calendarName.trim())}만 읽어서, 한국 시간 오늘부터 90일 뒤까지의 마일스톤을 daylight에 동기화해줘. 페이지가 여러 개면 끝까지 읽고 성공한 뒤에만 sync_google_calendar_milestones를 호출해. 이 캘린더 일정이 사이트의 모든 팀원에게 공유되는 것을 허용해. 일정의 원래 ID와 제목을 유지하고, 종일 일정은 start.date, 시간 일정은 한국 시간 시작 날짜를 사용해. Google 캘린더에는 아무것도 쓰지 마. 내가 직접 작성한 일일 할 일은 get_daily_plan으로 읽기만 하고 추가·수정·완료 처리하지 마. 자동 실행은 아직 설정하지 마.` : "";

  function milestoneItem(item: Milestone, expanded = false) {
    const key = milestoneKey(item);
    return <div className={`milestone-item ${expanded ? "expanded" : ""} ${draggingKey === key ? "is-dragging" : ""}`} key={key} data-milestone-key={key}>
      <button className="milestone-point milestone-drag-handle" type="button" disabled={busy || visibleMilestones.length < 2} onPointerDown={event => beginMilestoneDrag(event, item)} onKeyDown={event => void milestoneKeyDown(event, item)} aria-label={`${item.title} 순서 변경, 위아래 방향키로 이동`} title="드래그하거나 ↑ ↓ 키로 순서 변경"><GripVertical size={16} /></button>
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
      <nav aria-label="주 메뉴">
        <button aria-current={view === "mine" ? "page" : undefined} onClick={() => setView("mine")}><Sunrise size={18} />내 할 일</button>
        <button aria-current={view === "team" ? "page" : undefined} onClick={() => { setView("team"); setPerson("all"); }}><Users size={18} />팀 할 일</button>
        <button aria-current={view === "milestones" ? "page" : undefined} onClick={() => setView("milestones")}><Flag size={18} />마일스톤</button>
        <button title="공유 및 팀원 초대" onClick={() => setModal("share")}><Share2 size={18} />공유</button>
        <button title="연결 및 내 프로필" onClick={() => setModal("connections")}><Settings2 size={18} />설정</button>
      </nav>
    </aside>
    <div className="main-shell">
      <main>
        <h1 className="sr-only">{view === "mine" ? "내 할 일" : view === "team" ? "팀 할 일" : "마일스톤"}</h1>
        <div className="date-toolbar"><div className="date-title"><CalendarDays size={17} /><strong>{longDate(date)}</strong>{date === today() && <span className="today-tag">오늘</span>}</div><div className="date-controls"><button className="text-button" onClick={() => selectDate(today())} disabled={busy}>오늘로</button><label className="date-picker"><CalendarDays size={15} /><input type="date" value={date} min="2000-01-01" max="2100-09-01" onChange={event => selectDate(event.target.value)} disabled={busy} aria-label="날짜 선택" /></label><button className={`icon-button ${refreshing ? "rotating" : ""}`} onClick={() => void load(date, true)} disabled={refreshing || busy} aria-label="새로고침"><RefreshCw size={15} /></button></div></div>
        {error && <div className="error-banner" role="alert"><span>{error}{data ? " 마지막으로 불러온 내용을 표시하고 있어요." : ""}</span><button onClick={() => void load(date, true)}>다시 시도</button></div>}
        <div className="week-strip"><button className="icon-button week-arrow" aria-label="지난주" onClick={() => selectDate(addDays(date, -7))} disabled={busy || date < "2000-01-08"}><ChevronLeft size={17} /></button>{week.map(value => <button key={value} className={`week-day ${value === date ? "selected" : ""} ${value === today() ? "actual-today" : ""}`} disabled={busy} onClick={() => selectDate(value)} aria-pressed={value === date}><span>{weekday(value)}</span><strong>{Number(value.slice(-2))}</strong><i /></button>)}<button className="icon-button week-arrow" aria-label="다음주" onClick={() => selectDate(addDays(date, 7))} disabled={busy || date > "2100-08-25"}><ChevronRight size={17} /></button></div>
        {!data ? (!error && <div className="loading-state" role="status"><LoaderCircle size={23} className="spin" /><p>불러오는 중…</p></div>) : <div className={`content-grid ${view === "milestones" ? "milestones-layout" : ""}`}>
          <div className="primary-column">
            {view === "mine" && <section className="card tasks-card">
              <div className="section-heading">
                <div className="section-title"><h2>할 일</h2></div>
                <span className="completion-label"><strong>{completed}</strong> / {myTasks.length} 완료</span>
              </div>
              <div className="task-progress"><span style={{ width: `${myTasks.length ? completed / myTasks.length * 100 : 0}%` }} /></div>
              <form className="task-composer" onSubmit={async event => {
                event.preventDefault();
                if (await mutate({ op: "task.add", date, title: draft })) {
                  setDraft("");
                  setFilter("all");
                  taskInput.current?.focus();
                }
              }}>
                <input ref={taskInput} value={draft} onChange={event => setDraft(event.target.value)} maxLength={240} placeholder="새 할 일" aria-label="새 할 일" disabled={busy} />
                <button aria-label="할 일 추가" disabled={busy || !draft.trim()}>추가</button>
              </form>
              <div className="task-filter" aria-label="할 일 필터">{[["all", "전체"], ["open", "할 일"], ["done", "완료"]].map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}{key === "done" && <span>{completed}</span>}</button>)}</div>
              {ownFiltered.length ? <ul className="task-list">{ownFiltered.map(task => taskRow(task))}</ul> : <p className="empty-tasks">{myTasks.length ? filter === "done" ? "완료한 할 일 없음" : "남은 할 일 없음" : "할 일 없음"}</p>}
            </section>}
            {view === "team" && <><div className="team-view-heading"><h2>팀원 <span>{data.members.length}명</span></h2><div className="team-totals"><CheckCheck size={16} /><strong>{teamCompleted}</strong><span>/ {data.tasks.length} 완료</span></div></div><div className="person-filters"><button className={person === "all" ? "selected" : ""} onClick={() => setPerson("all")}>모두</button>{data.members.map((member, i) => <button className={person === member.id ? "selected" : ""} key={member.id} onClick={() => setPerson(member.id)}><Avatar name={member.name} index={i} small />{member.name}</button>)}</div>{data.members.filter(member => person === "all" || person === member.id).map((member, i) => {
              const tasks = data.tasks.filter(task => task.ownerId === member.id);
              const count = tasks.filter(task => task.done).length;
              return <section key={member.id} className="card member-card"><div className="member-card-heading"><Avatar name={member.name} index={i} /><div><h3>{member.name}{member.id === data.me.id && <span className="me-label">나</span>}</h3><span>{tasks.length ? `${tasks.length - count}개 남음 · ${count}개 완료` : "할 일 없음"}</span></div><span className="member-percent">{tasks.length ? Math.round(count / tasks.length * 100) : 0}<small>%</small></span></div>{tasks.length > 0 && <><div className="task-progress"><span style={{ width: `${count / tasks.length * 100}%` }} /></div><ul className="task-list">{tasks.map(task => taskRow(task, task.ownerId !== data.me.id))}</ul></>}</section>;
            })}</>}
            {view === "milestones" && <section className="card full-milestones" onPointerMove={moveMilestoneDrag} onPointerUp={event => void endMilestoneDrag(event)} onPointerCancel={cancelMilestoneDrag} onLostPointerCapture={cancelMilestoneDrag}><div className="section-heading"><div className="section-title"><Flag size={18} /><h2>다가오는 마일스톤</h2><span className="count-pill">{data.milestones.length}</span></div><span className="tiny muted">선택한 날부터 90일</span></div><p className="milestone-intro">손잡이를 드래그하거나 ↑ ↓ 키로 바꾼 순서는 팀 전체에 적용됩니다.</p>{data.milestones.length ? visibleMilestones.map(item => milestoneItem(item, true)) : <div className="empty-milestones"><h3>{data.sources.length ? "이 기간에 마일스톤 없음" : "Google Calendar 미연결"}</h3><button className="button secondary" onClick={() => setModal("connections")}><Link2 size={14} />연결 관리</button></div>}</section>}
          </div>
          <aside className="right-column">
            <section className="card milestones-card" onPointerMove={moveMilestoneDrag} onPointerUp={event => void endMilestoneDrag(event)} onPointerCancel={cancelMilestoneDrag} onLostPointerCapture={cancelMilestoneDrag}><div className="section-heading"><div className="section-title"><Flag size={16} /><h2>다가오는 마일스톤</h2></div><button className="icon-button" aria-label="전체 마일스톤 보기" onClick={() => setView("milestones")}><ArrowRight size={16} /></button></div><div className="source-label"><span className="google-calendar-icon">31</span>Google Calendar<span className={`source-state ${data.sources.length ? "connected" : ""}`}>{data.sources.length ? "가져온 일정" : "연결 전"}</span></div>{data.milestones.length ? visibleMilestones.slice(0, 4).map(item => milestoneItem(item)) : <div className="milestones-mini-empty">{data.sources.length ? <p>예정된 마일스톤 없음</p> : <button className="text-button" onClick={() => setModal("connections")}>캘린더 연결<ArrowRight size={13} /></button>}</div>}{data.sources.length > 0 && <div className="milestone-card-footer"><RefreshCw size={11} /><span>최근 동기화 {syncTime(data.sources[0].syncedAt)}</span></div>}</section>
          </aside>
        </div>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <dialog ref={dialog} className="app-dialog" onCancel={() => setModal(null)} aria-labelledby="dialog-title" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="dialog-inner"><div className="dialog-heading"><h2 id="dialog-title">{modal === "connections" ? "나의 프로필과 연결" : modal === "share" ? "사이트 공유" : "할 일을 삭제할까요?"}</h2><button className="icon-button" aria-label="닫기" onClick={() => setModal(null)}><X size={19} /></button></div>
      {modal === "connections" && <><form className="profile-form" onSubmit={async event => { event.preventDefault(); await mutate({ op: "profile.save", name: nameDraft }, "이름을 저장했어요."); }}><label htmlFor="profile-name">팀에 보이는 내 이름</label><div><input id="profile-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} maxLength={40} required /><button className="button secondary compact" disabled={busy}>저장</button></div></form><div className="connection-explainer"><span className="google-calendar-icon">31</span><span>Google Calendar</span><ArrowRight size={14} /><span className="dots-logo"><i /><i /><i /></span><span>dots</span><ArrowRight size={14} /><strong>daylight</strong></div><h3 className="dialog-section-title">마일스톤만 캘린더에서 가져와요</h3><p className="dialog-description">dots에 Google Calendar와 daylight를 연결한 뒤, 아래 요청을 전달하세요. 선택한 캘린더의 일정은 이 공간의 모든 팀원에게 보입니다. 일일 할 일은 직접 작성하고 관리해요.</p><ol className="connection-steps"><li><strong>daylight 앱 연결</strong><span>ChatGPT의 플러그인에서 개인 → 내가 만든 항목 → daylight를 설치하거나 연결하세요.</span><a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">플러그인 열기<ExternalLink size={12} /></a></li><li><strong>dots에 Google Calendar 연결</strong><span>dots의 연결된 앱에서 Google Calendar 사용 권한을 확인하세요.</span></li><li><strong>팀에 공유할 캘린더 지정</strong><label htmlFor="calendar-name">캘린더 이름 또는 ID</label><input id="calendar-name" value={calendarName} onChange={event => setCalendarName(event.target.value)} maxLength={300} placeholder="예: 팀 마일스톤" /></li></ol>{connectionPrompt && <textarea className="copy-prompt" value={connectionPrompt} readOnly rows={5} aria-label="dots에 전달할 요청" />}<button className="button primary full" disabled={!connectionPrompt} onClick={() => void copy(connectionPrompt, "요청을 복사했어요. dots 대화에 붙여넣어주세요.")}><Copy size={15} />dots에 전달할 요청 복사</button><p className="connection-footnote">직접 Google에 로그인하는 방식이 아닌 dots를 통한 동기화예요. 자동 실행은 별도 설정이 필요하며, 현재 예약된 작업은 없습니다.</p>{!!data?.sources.length && <div className="connected-sources"><h3>마지막으로 가져온 캘린더</h3>{data.sources.map(source => <div key={`${source.ownerId}:${source.calendarId}`}><strong>{source.name}</strong><span>{source.ownerName} · {syncTime(source.syncedAt)}</span></div>)}</div>}</>}
      {modal === "share" && <><p className="dialog-description">초대된 팀원은 서로의 일일 할 일과 공통 마일스톤을 볼 수 있어요. 할 일은 본인만 수정할 수 있습니다.</p><div className="share-link"><input value={typeof window !== "undefined" ? window.location.origin : ""} readOnly aria-label="사이트 공유 주소" /><button className="button primary compact" onClick={() => void copy(window.location.origin, "공유 링크를 복사했어요.")}><Copy size={14} />복사</button></div><div className="share-privacy"><LockKeyhole size={17} /><p><strong>접근 권한을 받은 계정만 들어올 수 있어요.</strong><span>추가할 팀원의 이메일을 이 사이트를 만든 Codex 대화에 알려주세요. 초대가 적용된 뒤 같은 계정으로 로그인하면 함께 사용할 수 있어요.</span></p></div><div className="share-members"><h3>참여한 멤버 <span>{data?.members.length || 0}</span></h3>{data?.members.map((member, i) => <div key={member.id}><Avatar name={member.name} index={i} small /><span>{member.name}</span>{member.id === data.me.id && <span className="me-label">나</span>}</div>)}</div></>}
      {modal === "delete" && <><p className="dialog-description">‘{deleteTask?.title}’을(를) 목록에서 삭제합니다.</p><div className="dialog-buttons"><button className="button secondary" onClick={() => setModal(null)}>취소</button><button className="button danger" disabled={busy} onClick={async () => { if (deleteTask && await mutate({ op: "task.delete", id: deleteTask.id }, "할 일을 삭제했어요.")) { setModal(null); setDeleteTask(null); } }}>삭제</button></div></>}
    </div></dialog>
  </div>;
}
