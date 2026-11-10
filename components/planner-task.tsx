"use client";

import { useState, type CSSProperties } from "react";
import { ArrowRight, Check, FolderOpen, MoreHorizontal, Pencil, Star, Trash2, X } from "lucide-react";
import { addDays, taskHue } from "../lib/planner-core";
import type { Subtask, Task } from "../lib/planner-core";

type Props = {
  task: Task; date: string; busy: boolean; readOnly: boolean;
  onChange: (input: Record<string, unknown>, message?: string) => Promise<boolean>;
  onDelete: (task: Task, child?: Subtask) => void;
  onOpenWorkLog?: (task: Task) => void;
};
const label = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;

export function PlannerTask({ task, date, busy, readOnly, onChange, onDelete, onOpenWorkLog }: Props) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [start, setStart] = useState(task.date);
  const [end, setEnd] = useState(task.endDate ?? task.date);
  const [childTitle, setChildTitle] = useState("");
  const [childDate, setChildDate] = useState(date < task.date ? task.date : date > (task.endDate ?? task.date) ? (task.endDate ?? task.date) : date);
  const [editChild, setEditChild] = useState<Subtask | null>(null);
  const children = task.subtasks;
  const completed = children.filter(child => child.done).length;

  return <li className={`task-item task-color ${children.length || task.endDate ? "task-family" : ""}`} style={{ "--task-hue": taskHue(task.id) } as CSSProperties}>
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button className={`task-check ${task.done ? "checked" : ""}`} disabled={busy || readOnly || children.length > 0}
        onClick={() => void onChange({ op: "task.patch", id: task.id, done: !task.done })}
        aria-label={`${task.title} ${children.length ? `${completed}/${children.length} 완료` : task.done ? "완료 취소" : "완료"}`}
        title={children.length ? "하위 할 일을 모두 완료하면 완료됩니다" : undefined}>
        {task.done ? <Check size={13} strokeWidth={3} /> : null}
      </button>
      {editing && !readOnly ? <form className="task-edit-form" onSubmit={async event => {
        event.preventDefault();
        if (await onChange({ op: "task.patch", id: task.id, title, date: start, endDate: end === start ? null : end })) setEditing(false);
      }}>
        <input autoFocus value={title} onChange={event => setTitle(event.target.value)} maxLength={240} required aria-label="할 일 제목" />
        <div className="task-period-fields">
          <label>시작일<input type="date" value={start} min="2000-01-01" max="2100-09-01" required onChange={event => setStart(event.target.value)} /></label>
          <span>—</span><label>종료일<input type="date" value={end} min={start} max="2100-09-01" required onChange={event => setEnd(event.target.value)} /></label>
          <button className="text-button" disabled={busy}>저장</button><button type="button" className="icon-button" aria-label="수정 취소" onClick={() => setEditing(false)}><X size={14} /></button>
        </div>
      </form> : <div className="task-content"><span className="task-title">{task.title}</span>{task.endDate && <span className="task-period">{label(task.date)} – {label(task.endDate)}</span>}</div>}
      {task.important && readOnly ? <Star size={14} className="starred" /> : null}
      {!readOnly && !editing && <div className="task-actions">
        <button className={`icon-button star-button ${task.important ? "starred" : ""}`} aria-label={`${task.title} 중요 표시 ${task.important ? "해제" : "설정"}`} disabled={busy} onClick={() => void onChange({ op: "task.patch", id: task.id, important: !task.important })}><Star size={15} /></button>
        <div className="task-menu-anchor"><button className="icon-button" aria-label={`${task.title} 메뉴`} aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
          {menu && <div className="task-menu">
            {onOpenWorkLog && <button onClick={() => { onOpenWorkLog(task); setMenu(false); }}><FolderOpen size={13} />작업물·기록 연결</button>}
            <button onClick={() => { setTitle(task.title); setStart(task.date); setEnd(task.endDate ?? task.date); setEditing(true); setMenu(false); }}><Pencil size={13} />제목·기간 수정</button>
            {!task.endDate && !children.length && <button disabled={busy || date >= "2100-09-01"} onClick={async () => { if (await onChange({ op: "task.patch", id: task.id, date: addDays(date, 1), done: false }, "다음 날 할 일로 옮겼어요.")) setMenu(false); }}><ArrowRight size={13} />다음 날로 옮기기</button>}
            <button className="danger-text" onClick={() => { onDelete(task); setMenu(false); }}><Trash2 size={13} />삭제</button>
          </div>}
        </div>
      </div>}
    </div>
    {(task.endDate || children.length > 0) && <details className="subtasks" open>
      <summary>하위 할 일 <span>{completed} / {children.length}</span></summary>
      {children.length > 0 && <ul>{children.map(child => <li key={child.id} className={`subtask-row ${child.date === date ? "subtask-today" : ""}`}>
        <button className={`task-check ${child.done ? "checked" : ""}`} disabled={busy || readOnly} onClick={() => void onChange({ op: "subtask.patch", id: child.id, done: !child.done })} aria-label={`${child.title} ${child.done ? "완료 취소" : "완료"}`}>
          {child.done ? <Check size={12} strokeWidth={3} /> : null}
        </button>
        {editChild?.id === child.id ? <form className="subtask-form" onSubmit={async event => {
          event.preventDefault();
          if (await onChange({ op: "subtask.patch", id: child.id, title: editChild.title, date: editChild.date })) setEditChild(null);
        }}>
          <input value={editChild.title} onChange={event => setEditChild({ ...editChild, title: event.target.value })} maxLength={240} required aria-label="하위 할 일 제목" />
          <input type="date" value={editChild.date} min={task.date} max={task.endDate ?? task.date} required onChange={event => setEditChild({ ...editChild, date: event.target.value })} aria-label="하위 할 일 날짜" />
          <button className="text-button" disabled={busy}>저장</button><button type="button" className="icon-button" aria-label="수정 취소" onClick={() => setEditChild(null)}><X size={13} /></button>
        </form> : <>
          <span className={`subtask-title ${child.done ? "subtask-done" : ""}`}>{child.title}</span><time dateTime={child.date}>{label(child.date)}</time>
          {!readOnly && <><button className="icon-button" aria-label={`${child.title} 수정`} disabled={busy} onClick={() => setEditChild({ ...child })}><Pencil size={12} /></button><button className="icon-button" aria-label={`${child.title} 삭제`} disabled={busy} onClick={() => onDelete(task, child)}><Trash2 size={12} /></button></>}
        </>}
      </li>)}</ul>}
      {!readOnly && <form className="subtask-form subtask-add" onSubmit={async event => {
        event.preventDefault();
        if (await onChange({ op: "subtask.add", taskId: task.id, title: childTitle, date: childDate })) setChildTitle("");
      }}>
        <input value={childTitle} onChange={event => setChildTitle(event.target.value)} placeholder="하위 할 일" aria-label={`${task.title} 하위 할 일 추가`} maxLength={240} required disabled={busy} />
        <input type="date" value={childDate} min={task.date} max={task.endDate ?? task.date} required onChange={event => setChildDate(event.target.value)} aria-label="하위 할 일 날짜" disabled={busy} />
        <button className="text-button" disabled={busy || !childTitle.trim()}>추가</button>
      </form>}
    </details>}
  </li>;
}
