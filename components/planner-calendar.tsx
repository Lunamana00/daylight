"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, Square } from "lucide-react";
import { ko } from "react-day-picker/locale";
import { Calendar, CalendarDayButton } from "./ui/calendar";
import { addDays, calendarTaskGroups, calendarTaskLanes, calendarWeekLayout, calendarWeekOffsets, milestoneKey, monthRange, taskHue, today, weekRange } from "../lib/planner-core";
import type { CalendarData, DayData } from "../lib/planner-core";

const calendarDate = (value: string) => new Date(value + "T00:00:00+09:00");
const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(calendarDate(value));
const firstDate = calendarDate("2000-01-01");
const lastDate = calendarDate("2100-09-01");

export function PlannerCalendar({ date, data, busy, onSelectDate, onManage, onChange }: {
  date: string; data: DayData; busy: boolean; onSelectDate: (date: string) => void; onManage: () => void;
  onChange: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const month = date.slice(0, 7);
  const [view, setView] = useState<"week" | "month">("week");
  const { from, to } = view === "week" ? weekRange(date) : monthRange(date);
  const [saved, setSaved] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const taskBoard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/planner?view=${view}&date=${from}`, { cache: "no-store" });
        const value = await response.json() as CalendarData & { error?: string };
        if (!response.ok) throw new Error(value.error || "달력을 불러오지 못했어요.");
        if (active) setSaved(value);
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "연결을 확인해 주세요."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [from, to, view, data]);
  const current = saved?.from === from && saved.to === to ? saved : null;
  const selectedEvents = current?.milestones.filter(item => item.date === date) ?? [];
  const offset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => addDays(date, i - offset));
  useLayoutEffect(() => {
    const board = taskBoard.current;
    if (!board) return;
    const cards = Array.from(board.children) as HTMLElement[];
    const arrange = () => {
      const sizes = cards.map(card => ({
        column: Number(card.dataset.column), span: Number(card.dataset.span),
        height: Math.max(1, Math.ceil(card.getBoundingClientRect().height)),
      }));
      calendarWeekOffsets(sizes).forEach((top, index) => {
        cards[index].style.gridRow = `${top + 1} / span ${sizes[index].height}`;
      });
      board.classList.add("is-compact");
    };
    arrange();
    const observer = new ResizeObserver(arrange);
    observer.observe(board);
    cards.forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [current, view]);

  return <section className="card planner-calendar-card" aria-label="내 일정 달력" aria-busy={loading}>
    <div className="calendar-toolbar">
      <div className="calendar-legend"><span><Square size={12} />내 할 일</span><span><CalendarDays size={12} />Google 일정</span></div>
      <div className="calendar-view-controls"><div className="calendar-view-switch" role="group" aria-label="달력 보기">{(["week", "month"] as const).map(mode => <button key={mode} aria-pressed={view === mode} disabled={busy} onClick={() => setView(mode)}>{mode === "week" ? "주간" : "월간"}</button>)}</div><button className="text-button" onClick={onManage}>캘린더 관리</button></div>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {view === "week" ? <>
      <div className="calendar-week-heading">
        <button className="icon-button" aria-label="지난주" disabled={busy || from <= "2000-01-01"} onClick={() => onSelectDate(addDays(date, -7) < "2000-01-01" ? "2000-01-01" : addDays(date, -7))}><ChevronLeft size={18} /></button>
        <h3>{from.slice(0, 4)}년 {dateLabel(from)} – {from.slice(0, 4) !== to.slice(0, 4) ? `${to.slice(0, 4)}년 ` : ""}{dateLabel(to)}</h3>
        <button className="icon-button" aria-label="다음 주" disabled={busy || to >= "2100-09-01"} onClick={() => onSelectDate(addDays(date, 7) > "2100-09-01" ? "2100-09-01" : addDays(date, 7))}><ChevronRight size={18} /></button>
      </div>
      <div className="planner-week-scroll"><div className="planner-week-board" style={{ "--selected-start": `${offset / 7 * 100}%`, "--selected-end": `${(offset + 1) / 7 * 100}%` } as CSSProperties}>
        <div className="calendar-week-dates">{week.map((key, index) => <button key={key} className={`${key === date ? "selected" : ""} ${key === today() ? "actual-today" : ""}`} aria-pressed={key === date} aria-label={dateLabel(key)} disabled={busy || key < "2000-01-01" || key > "2100-09-01"} onClick={() => onSelectDate(key)}><span>{["월", "화", "수", "목", "금", "토", "일"][index]}</span><strong>{Number(key.slice(5, 7))}.{Number(key.slice(8))}</strong></button>)}</div>
        <div className="calendar-week-tasks" ref={taskBoard}>{calendarWeekLayout(current?.tasks ?? [], week[0], week[6]).map(({ task, start, end, column, span, row }) => {
          if (!task.subtasks.length && (!task.endDate || task.endDate === task.date)) {
            return <section className="calendar-week-task-row" key={task.id} aria-label={task.title} data-column={column} data-span={span} style={{ gridColumn: column, gridRow: row }}>
              <div className="calendar-task-group task-color" style={{ "--task-hue": taskHue(task.id) } as CSSProperties}>
                <label className={`calendar-week-task ${task.done ? "is-complete" : ""}`}>
                  <input type="checkbox" checked={Boolean(task.done)} disabled={busy || loading} aria-label={`${task.title} ${task.done ? "완료 취소" : "완료"}`} onChange={() => void onChange({ op: "task.patch", id: task.id, done: !task.done })} />
                  <span className="week-task-title">{task.title}</span>
                </label>
              </div>
            </section>;
          }
          const taskEnd = task.endDate ?? task.date;
          return <section key={task.id} className="calendar-week-family task-color" data-column={column} data-span={span} style={{ "--task-hue": taskHue(task.id), gridColumn: `${column} / span ${span}`, gridRow: row, gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` } as CSSProperties} aria-label={task.title}>
            <button
              className={`calendar-week-period ${task.done ? "period-done" : ""}`}
              data-joins-start={task.subtasks.some(child => child.date === start)}
              data-joins-end={task.subtasks.some(child => child.date === end)}
              style={{ gridColumn: "1 / -1", gridRow: 1 }}
              disabled={busy}
              onClick={() => onSelectDate(start)}
              title={`${task.title} · ${dateLabel(task.date)} – ${dateLabel(taskEnd)}`}
            >
              {task.date < from && <span aria-hidden="true">‹</span>}<span className="week-period-title">{task.title}</span>{task.subtasks.length > 0 ? <small>{task.subtasks.filter(child => child.done).length}/{task.subtasks.length}</small> : task.done ? <Check size={12} /> : null}{taskEnd > to && <span aria-hidden="true">›</span>}
            </button>
            {week.slice(column - 1, column - 1 + span).map((key, index) => {
              const children = task.subtasks.filter(child => child.date === key);
              if (!children.length) return null;
              return <div key={key} className="calendar-task-group calendar-attached-children" style={{ gridColumn: index + 1, gridRow: 2 }} role="group" aria-label={`${dateLabel(key)} · ${task.title} 하위 할 일`}>
                <ul className="calendar-group-children">{children.map(child => <li key={child.id}>
                  <label className={`calendar-week-task ${child.done ? "is-complete" : ""}`}>
                    <input type="checkbox" checked={Boolean(child.done)} disabled={busy || loading} aria-label={`${task.title} · ${child.title} ${child.done ? "완료 취소" : "완료"}`} onChange={() => void onChange({ op: "subtask.patch", id: child.id, done: !child.done })} />
                    <span className="week-task-title">{child.title}</span>
                  </label>
                </li>)}</ul>
              </div>;
            })}
          </section>;
        })}</div>
        <div className="calendar-week-columns">{week.map(key => {
          const events = current?.milestones.filter(item => item.date === key) ?? [];
          return <section key={key} className={`calendar-week-column ${key === date ? "selected" : ""}`} aria-label={dateLabel(key)}>
            {events.length > 0 && <div className="calendar-week-events">{events.map(item => <div className="calendar-week-event" key={milestoneKey(item)}><CalendarDays size={12} /><div>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <span>{item.title}</span>}<small>{item.sourceName}</small></div></div>)}</div>}
          </section>;
        })}</div>
      </div></div>
    </> : <Calendar
      className="planner-month"
      mode="single" required locale={ko} timeZone="Asia/Seoul" weekStartsOn={1}
      month={calendarDate(month + "-01")} selected={calendarDate(date)}
      onSelect={value => onSelectDate(today(value))}
      onMonthChange={value => onSelectDate(today(value))}
      startMonth={firstDate} endMonth={lastDate}
      disabled={busy ? true : [{ before: firstDate }, { after: lastDate }]}
      disableNavigation={busy} showOutsideDays={false}
      labels={{ labelPrevious: () => "지난달", labelNext: () => "다음 달" }}
      classNames={{
        root: "planner-month", months: "calendar-months", month: "calendar-month",
        nav: "calendar-month-nav", button_previous: "icon-button", button_next: "icon-button",
        month_caption: "calendar-month-caption", caption_label: "calendar-month-title",
        month_grid: "calendar-month-grid", weekdays: "calendar-weekdays", weekday: "calendar-weekday",
        week: "calendar-week", day: "calendar-day", today: "calendar-today", hidden: "calendar-hidden",
        disabled: "calendar-disabled", outside: "calendar-outside",
      }}
      components={{ DayButton: props => {
        const key = today(props.day.date);
        const tasks = current?.tasks.filter(task => task.date <= key && (task.endDate ?? task.date) >= key) ?? [];
        const groups = calendarTaskGroups(tasks, key);
        const dailyCount = groups.reduce((count, group) => count + group.items.length, 0);
        const events = current?.milestones.filter(item => item.date === key) ?? [];
        const weekday = (new Date(key + "T00:00:00Z").getUTCDay() + 6) % 7;
        const from = current && current.from > addDays(key, -weekday) ? current.from : addDays(key, -weekday);
        const to = current && current.to < addDays(key, 6 - weekday) ? current.to : addDays(key, 6 - weekday);
        const lanes = calendarTaskLanes(current?.tasks ?? [], from, to);
        const extra = groups.slice(2).reduce((count, group) => count + group.items.length, 0) + Math.max(0, events.length - 2);
        const periodsLabel = tasks.filter(task => task.endDate && task.endDate > task.date).map(task => `${task.title}, ${dateLabel(task.date)}부터 ${dateLabel(task.endDate!)}까지`).join(". ");
        return <CalendarDayButton {...props} className="calendar-date-button" aria-label={`${dateLabel(key)}, 내 할 일 ${dailyCount}개, Google 일정 ${events.length}개${periodsLabel ? `. ${periodsLabel}` : ""}`}>
          <span className="calendar-date-number">{Number(key.slice(-2))}</span>
          {lanes.length > 0 && <span className="calendar-period-lanes" aria-hidden="true">{lanes.map((lane, index) => {
            const task = lane.find(item => item.date <= key && item.endDate! >= key);
            if (!task) return <span className="calendar-period-slot" key={index} />;
            const first = task.date === key || key === from;
            const last = task.endDate === key || key === to;
            const end = task.endDate! < to ? task.endDate! : to;
            const days = (Date.parse(end) - Date.parse(key)) / 86_400_000 + 1;
            return <span key={index} className={`calendar-period-bar task-color ${task.date === key ? "period-start" : ""} ${task.endDate === key ? "period-end" : ""} ${task.done ? "period-done" : ""}`} style={{ "--task-hue": taskHue(task.id) } as CSSProperties} title={`${task.title} · ${dateLabel(task.date)} – ${dateLabel(task.endDate!)}`}>
              {first && <span className="calendar-period-label" style={{ "--period-days": days } as CSSProperties}>{task.date < key ? "‹ " : ""}{task.done ? "✓ " : ""}{task.title}</span>}
              {last && task.endDate! > key && <span className="calendar-period-continues">›</span>}
            </span>;
          })}</span>}
          <span className="calendar-cell-items" aria-hidden="true">
            {groups.slice(0, 2).map(({ task, items }) => <span className={`calendar-month-group task-color ${task.subtasks.length ? "has-children" : ""}`} key={task.id} style={{ "--task-hue": taskHue(task.id) } as CSSProperties} title={task.title}>
              {task.subtasks.length > 0 && <span className="calendar-month-parent">{task.title}</span>}
              <span className={task.subtasks.length ? "calendar-month-children" : ""}>{items.slice(0, 2).map(item => <span className={`calendar-chip calendar-task ${item.done ? "calendar-done" : ""}`} key={item.id} title={item.title}>
                {item.done ? <Check size={10} /> : <Square size={10} />}<span>{item.title}</span>
              </span>)}</span>
              {items.length > 2 && <span className="calendar-group-more">+{items.length - 2}개</span>}
            </span>)}
            {events.slice(0, 2).map(item => <span className="calendar-chip calendar-event" key={milestoneKey(item)} title={`${item.sourceName} · ${item.title}`}><CalendarDays size={10} /><span>{item.title}</span></span>)}
            {extra > 0 && <span className="calendar-more">+{extra}개</span>}
          </span>
        </CalendarDayButton>;
      } }}
    />}
    {loading && !current && <p className="calendar-status" role="status">달력 불러오는 중…</p>}
    {view === "month" && <div className="calendar-selected-events">
      <h3>{dateLabel(date)} <span>Google 일정</span></h3>
      {selectedEvents.length ? selectedEvents.map(item => <div className="calendar-event-row" key={milestoneKey(item)}>
        <CalendarDays size={15} /><div>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={12} /></a> : <span>{item.title}</span>}<small>{item.sourceName}</small></div>
      </div>) : !loading && !error ? <p className="muted tiny">{data.sources.length ? "이날 일정 없음" : "연결된 캘린더 없음"}</p> : null}
    </div>}
  </section>;
}
