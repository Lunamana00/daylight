"use client";

import { useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, FolderOpen, GripVertical, MoreHorizontal, Pencil, Star, Trash2, X } from "lucide-react";
import { addDays, taskHue } from "../lib/planner-core";
import type { BacklogItem, Subtask, Task, TaskProject } from "../lib/planner-core";
import { PlannerBacklogRow } from "./planner-backlog";
import { PlannerSortableList } from "./planner-sortable-list";

type Props = {
  task: Task; projects: TaskProject[]; date: string; busy: boolean; readOnly: boolean;
  previousTaskId?: string; nextTaskId?: string;
  reorderable?: boolean;
  orderScope?: "day" | "all";
  initialEditing?: boolean;
  initialChildId?: string;
  grouped?: boolean;
  showDate?: boolean;
  backlog?: BacklogItem[];
  onDeleteBacklog?: (item: BacklogItem) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onChange: (input: Record<string, unknown>, message?: string) => Promise<boolean>;
  onDelete: (task: Task, child?: Subtask) => void;
  onOpenWorkLog?: (task: Task) => void;
};
const label = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;

export function PlannerTask({ task, projects, date, busy, readOnly, reorderable = true, orderScope = "day", initialEditing = false, initialChildId, grouped = false, showDate = false, backlog = [], onDeleteBacklog, previousTaskId, nextTaskId, onDraggingChange, onChange, onDelete, onOpenWorkLog }: Props) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(initialEditing && !readOnly);
  const [title, setTitle] = useState(task.title);
  const [start, setStart] = useState(task.date);
  const [end, setEnd] = useState(task.endDate ?? task.date);
  const [childTitle, setChildTitle] = useState("");
  const defaultChildDate = date < task.date ? task.date : date > (task.endDate ?? task.date) ? (task.endDate ?? task.date) : date;
  const [childDate, setChildDate] = useState(defaultChildDate);
  const [childScheduled, setChildScheduled] = useState(false);
  const [editChild, setEditChild] = useState<(Subtask & { date: string; scheduled: boolean }) | null>(() => {
    const child = !readOnly && initialChildId ? task.subtasks.find(item => item.id === initialChildId) : null;
    return child ? { ...child, date: child.date ?? defaultChildDate, scheduled: Boolean(child.date) } : null;
  });
  const [addingChild, setAddingChild] = useState(false);
  const children = task.subtasks;
  const childRows = [...children, ...(readOnly ? [] : backlog)].sort((a, b) => (a.done ?? 0) - (b.done ?? 0) || a.sortOrder - b.sortOrder);
  const childCount = children.length + (task.unscheduledCount ?? 0);
  const completed = children.filter(child => child.done).length;
  const move = (targetId?: string) => targetId && onChange({ op: "task.move", id: task.id, targetId, date, scope: orderScope }, "순서를 변경했어요.");
  const startEditing = () => { setTitle(task.title); setStart(task.date); setEnd(task.endDate ?? task.date); setEditing(true); setMenu(false); };
  const startChildEditing = (child: Subtask) => setEditChild({ ...child, date: child.date ?? defaultChildDate, scheduled: Boolean(child.date) });
  const childComposer = !readOnly && (addingChild ? <form className="subtask-form subtask-add" onSubmit={async event => {
    event.preventDefault();
    if (await onChange({ op: childScheduled ? "subtask.add" : "backlog.add", taskId: task.id, title: childTitle, date: childScheduled ? childDate : undefined })) { setChildTitle(""); setAddingChild(false); }
  }}>
    <input autoFocus value={childTitle} onChange={event => setChildTitle(event.target.value)} placeholder="하위 할 일" aria-label={`${task.title} 하위 할 일 추가`} maxLength={240} required disabled={busy} />
    <div className="subtask-add-footer"><div className="subtask-schedule-controls">
      <label className="schedule-checkbox"><input type="checkbox" aria-label="하위 할 일 날짜 지정" checked={childScheduled} disabled={busy} onChange={event => setChildScheduled(event.target.checked)} />날짜 지정</label>
      <input type="date" value={childDate} min={task.date} max={task.endDate ?? task.date} required={childScheduled} onChange={event => setChildDate(event.target.value)} aria-label="하위 할 일 날짜" disabled={busy || !childScheduled} />
    </div><div className="subtask-add-actions"><button className="text-button" disabled={busy || !childTitle.trim()}>추가</button><button type="button" className="icon-button" aria-label="하위 할 일 추가 닫기" disabled={busy} onClick={() => setAddingChild(false)}><X size={12} /></button></div></div>
  </form> : <button className="text-button subtask-add-toggle" disabled={busy} onClick={() => { setChildDate(defaultChildDate); setChildScheduled(false); setAddingChild(true); }}>＋ 하위 할 일</button>);

  return <li className={`task-item task-color ${task.projectId ? "" : "task-unassigned"} ${children.length || task.endDate ? "task-family" : ""}`} style={{ "--task-hue": taskHue(task) } as CSSProperties} data-sort-id={task.id} data-sort-done={task.done} data-sort-group="tasks">
    {!readOnly && task.projectId && <div className="task-project-header">
      <label className="task-project-picker"><span className="project-color-dot" aria-hidden="true" /><select aria-label={`${task.title} 프로젝트`} value={task.projectId ?? ""} disabled={busy} onChange={event => void onChange({ op: "task.link", taskId: task.id, artifactId: event.target.value || null })}>
        <option value="">프로젝트 연결 해제</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select></label>
      {onOpenWorkLog && <button className="text-button" onClick={() => onOpenWorkLog(task)}><FolderOpen size={12} />기록 보기</button>}
    </div>}
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      {reorderable && !readOnly && !editing && <button type="button" className="icon-button task-order-handle" data-sort-handle draggable={!busy} disabled={busy}
        aria-label={`${task.title} 순서 변경, 위아래 방향키로 이동`} title="드래그하거나 ↑ ↓ 키로 순서 변경"
        onPointerDown={() => setMenu(false)}><GripVertical size={14} /></button>}
      {!grouped && <button className={`task-check ${task.done ? "checked" : ""}`} disabled={busy || readOnly || childCount > 0}
        onClick={() => void onChange({ op: "task.patch", id: task.id, done: !task.done })}
        aria-label={`${task.title} ${childCount ? `${completed}/${childCount} 완료` : task.done ? "완료 취소" : "완료"}`}
        title={childCount ? "하위 할 일을 모두 완료하면 완료됩니다" : undefined}>
        {task.done ? <Check size={13} strokeWidth={3} /> : null}
      </button>}
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
      </form> : <div className="task-content">{grouped && !readOnly ? <button className="task-title task-title-edit" disabled={busy} onClick={startEditing}>{task.title}<Pencil size={12} aria-hidden="true" /></button> : <span className="task-title">{task.title}</span>}{task.endDate ? <span className="task-period">{label(task.date)} – {label(task.endDate)}</span> : showDate && <time className="task-period" dateTime={task.date}>{label(task.date)}</time>}</div>}
      {task.important && readOnly ? <Star size={14} className="starred" /> : null}
      {!readOnly && !editing && <div className="task-actions">
        <button className={`icon-button star-button ${task.important ? "starred" : ""}`} aria-label={`${task.title} 중요 표시 ${task.important ? "해제" : "설정"}`} disabled={busy} onClick={() => void onChange({ op: "task.patch", id: task.id, important: !task.important })}><Star size={15} /></button>
        <div className="task-menu-anchor"><button className="icon-button" aria-label={`${task.title} 메뉴`} aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
          {menu && <div className="task-menu">
            {reorderable && <><button disabled={busy || !previousTaskId} onClick={async () => { if (await move(previousTaskId)) setMenu(false); }}><ArrowUp size={13} />위로 이동</button>
            <button disabled={busy || !nextTaskId} onClick={async () => { if (await move(nextTaskId)) setMenu(false); }}><ArrowDown size={13} />아래로 이동</button></>}
            {onOpenWorkLog && <button onClick={() => { onOpenWorkLog(task); setMenu(false); }}><FolderOpen size={13} />{task.projectId ? "프로젝트·기록 보기" : "프로젝트 연결"}</button>}
            <button disabled={busy} onClick={startEditing}><Pencil size={13} />제목·기간 수정</button>
            {grouped && !childCount && <button disabled={busy} onClick={async () => { if (await onChange({ op: "task.patch", id: task.id, done: !task.done })) setMenu(false); }}><Check size={13} />{task.done ? "완료 취소" : "완료"}</button>}
            {!task.endDate && !childCount && <button disabled={busy || date >= "2100-09-01"} onClick={async () => { if (await onChange({ op: "task.patch", id: task.id, date: addDays(date, 1), done: false }, "다음 날 할 일로 옮겼어요.")) setMenu(false); }}><ArrowRight size={13} />다음 날로 옮기기</button>}
            <button className="danger-text" onClick={() => { onDelete(task); setMenu(false); }}><Trash2 size={13} />삭제</button>
          </div>}
        </div>
      </div>}
    </div>
    {children.length + backlog.length > 0 ? <details className="subtasks" open>
      <summary>하위 할 일 <span>{completed} / {childCount}</span></summary>
      <PlannerSortableList disabled={busy || readOnly} onDraggingChange={onDraggingChange} onMove={(id, targetId, position) => onChange({ op: "subtask.move", id, targetId, position, scope: "all" }, "순서를 변경했어요.")}>{childRows.map((child, index) => !("date" in child) ? onDeleteBacklog && <PlannerBacklogRow key={child.id} item={child} date={date} busy={busy} showParent={false} onChange={onChange} onDelete={onDeleteBacklog} /> : <li key={child.id} className={`subtask-row ${child.date === date ? "subtask-today" : ""}`} data-sort-id={child.id} data-sort-done={child.done}>
        {!readOnly && editChild?.id !== child.id && <button type="button" className="icon-button task-order-handle" data-sort-handle draggable={!busy} disabled={busy} aria-label={`${child.title} 순서 변경, 위아래 방향키로 이동`} title="드래그하거나 ↑ ↓ 키로 순서 변경"><GripVertical size={14} /></button>}
        <button className={`task-check ${child.done ? "checked" : ""}`} disabled={busy || readOnly} onClick={() => void onChange({ op: "subtask.patch", id: child.id, done: !child.done })} aria-label={`${child.title} ${child.done ? "완료 취소" : "완료"}`}>
          {child.done ? <Check size={12} strokeWidth={3} /> : null}
        </button>
        {editChild?.id === child.id ? <form className="subtask-form subtask-edit" onSubmit={async event => {
          event.preventDefault();
          if (await onChange({ op: "subtask.patch", id: child.id, title: editChild.title, date: editChild.scheduled ? editChild.date : null })) setEditChild(null);
        }}>
          <input value={editChild.title} onChange={event => setEditChild({ ...editChild, title: event.target.value })} maxLength={240} required aria-label="하위 할 일 제목" />
          <div className="subtask-add-footer"><div className="subtask-schedule-controls">
            <label className="schedule-checkbox"><input type="checkbox" aria-label="기존 하위 할 일 날짜 지정" checked={editChild.scheduled} disabled={busy} onChange={event => setEditChild({ ...editChild, scheduled: event.target.checked })} />날짜 지정</label>
            <input type="date" value={editChild.date} min={task.date} max={task.endDate ?? task.date} required={editChild.scheduled} disabled={busy || !editChild.scheduled} onChange={event => setEditChild({ ...editChild, date: event.target.value })} aria-label="하위 할 일 날짜" />
          </div><div className="subtask-add-actions"><button className="text-button" disabled={busy}>저장</button><button type="button" className="icon-button" aria-label="수정 취소" disabled={busy} onClick={() => setEditChild(null)}><X size={13} /></button></div></div>
        </form> : <>
          <span className={`subtask-title ${child.done ? "subtask-done" : ""}`}>{child.title}</span>{readOnly ? child.date && <time dateTime={child.date}>{label(child.date)}</time> : <button className="text-button subtask-date-button" disabled={busy} aria-label={`${child.title} 날짜 변경`} onClick={() => startChildEditing(child)}>{child.date ? <time dateTime={child.date}>{label(child.date)}</time> : "날짜 미정"}</button>}
          {!readOnly && <span className="subtask-order-actions">
            <button className="icon-button" aria-label={`${child.title} 위로 이동`} title="위로 이동" disabled={busy || !childRows[index - 1] || (childRows[index - 1].done ?? 0) !== child.done} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: childRows[index - 1].id, scope: "all" }, "순서를 변경했어요.")}><ArrowUp size={12} /></button>
            <button className="icon-button" aria-label={`${child.title} 아래로 이동`} title="아래로 이동" disabled={busy || !childRows[index + 1] || (childRows[index + 1].done ?? 0) !== child.done} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: childRows[index + 1].id, scope: "all" }, "순서를 변경했어요.")}><ArrowDown size={12} /></button>
          </span>}
          {!readOnly && <><button className="icon-button" aria-label={`${child.title} 수정`} disabled={busy} onClick={() => startChildEditing(child)}><Pencil size={12} /></button><button className="icon-button" aria-label={`${child.title} 삭제`} disabled={busy} onClick={() => onDelete(task, child)}><Trash2 size={12} /></button></>}
        </>}
      </li>)}</PlannerSortableList>
      {childComposer}
    </details> : !readOnly && (task.endDate || grouped) && <div className="subtasks">{childComposer}</div>}
  </li>;
}

export function PlannerDailySubtask({ task, child, date, busy, onChange, onOpenTask, onDelete }: {
  task: Task; child: Subtask; date: string; busy: boolean;
  onChange: Props["onChange"]; onOpenTask: (task: Task, childId?: string) => void; onDelete: Props["onDelete"];
}) {
  const siblings = task.subtasks.filter(item => item.date === date && item.done === child.done);
  const index = siblings.findIndex(item => item.id === child.id);
  return <li className={`task-item daily-subtask-row task-color ${task.projectId ? "" : "task-unassigned"}`} style={{ "--task-hue": taskHue(task) } as CSSProperties} data-sort-id={child.id} data-sort-done={child.done} data-sort-group={task.id}>
    {task.projectTitle && <div className="daily-task-project"><span className="project-color-dot" aria-hidden="true" />{task.projectTitle}</div>}
    <div className={`task-row ${child.done ? "is-done" : ""}`}>
      <button type="button" className="icon-button task-order-handle" data-sort-handle draggable={!busy} disabled={busy} aria-label={`${child.title} 순서 변경, 위아래 방향키로 이동`} title="드래그하거나 ↑ ↓ 키로 순서 변경"><GripVertical size={14} /></button>
      <button className={`task-check ${child.done ? "checked" : ""}`} disabled={busy} aria-label={`${child.title} ${child.done ? "완료 취소" : "완료"}`} onClick={() => void onChange({ op: "subtask.patch", id: child.id, done: !child.done })}>{child.done ? <Check size={13} strokeWidth={3} /> : null}</button>
      <div className="task-content"><button className="task-title task-title-edit" disabled={busy} onClick={() => onOpenTask(task, child.id)}>{child.title}</button><button className="daily-parent-link" disabled={busy} onClick={() => onOpenTask(task)}>{task.title}</button></div>
      <div className="task-actions">
        <span className="subtask-order-actions"><button className="icon-button" aria-label={`${child.title} 위로 이동`} disabled={busy || !siblings[index - 1]} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: siblings[index - 1].id, date }, "순서를 변경했어요.")}><ArrowUp size={12} /></button><button className="icon-button" aria-label={`${child.title} 아래로 이동`} disabled={busy || !siblings[index + 1]} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: siblings[index + 1].id, date }, "순서를 변경했어요.")}><ArrowDown size={12} /></button></span>
        <button className="icon-button" aria-label={`${child.title} 수정`} disabled={busy} onClick={() => onOpenTask(task, child.id)}><Pencil size={13} /></button><button className="icon-button" aria-label={`${child.title} 삭제`} disabled={busy} onClick={() => onDelete(task, child)}><Trash2 size={13} /></button>
      </div>
    </div>
  </li>;
}
