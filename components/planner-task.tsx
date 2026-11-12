"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, FolderOpen, GripVertical, MoreHorizontal, Pencil, Star, Trash2, X } from "lucide-react";
import { addDays, taskHue } from "../lib/planner-core";
import type { BacklogItem, Subtask, Task, TaskProject } from "../lib/planner-core";
import { PlannerBacklog } from "./planner-backlog";

type Props = {
  task: Task; projects: TaskProject[]; date: string; busy: boolean; readOnly: boolean;
  previousTaskId?: string; nextTaskId?: string;
  reorderable?: boolean;
  initialEditing?: boolean;
  initialChildId?: string;
  grouped?: boolean;
  showDate?: boolean;
  backlog?: BacklogItem[];
  onDeleteBacklog?: (item: BacklogItem) => void;
  draggedTask: Pick<Task, "id" | "done" | "date" | "endDate"> | null;
  onDragStart: () => void; onDragEnd: () => void;
  onChange: (input: Record<string, unknown>, message?: string) => Promise<boolean>;
  onDelete: (task: Task, child?: Subtask) => void;
  onOpenWorkLog?: (task: Task) => void;
};
const label = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;

export function PlannerTask({ task, projects, date, busy, readOnly, reorderable = true, initialEditing = false, initialChildId, grouped = false, showDate = false, backlog = [], onDeleteBacklog, previousTaskId, nextTaskId, draggedTask, onDragStart, onDragEnd, onChange, onDelete, onOpenWorkLog }: Props) {
  const [menu, setMenu] = useState(false);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);
  useEffect(() => setDropPosition(null), [draggedTask?.id]);
  const [editing, setEditing] = useState(initialEditing && !readOnly);
  const [title, setTitle] = useState(task.title);
  const [start, setStart] = useState(task.date);
  const [end, setEnd] = useState(task.endDate ?? task.date);
  const [childTitle, setChildTitle] = useState("");
  const [childDate, setChildDate] = useState("");
  const [editChild, setEditChild] = useState<Subtask | null>(() => !readOnly && initialChildId ? task.subtasks.find(child => child.id === initialChildId) ?? null : null);
  const [addingChild, setAddingChild] = useState(false);
  const children = task.subtasks;
  const childCount = children.length + (task.unscheduledCount ?? 0);
  const completed = children.filter(child => child.done).length;
  const move = (targetId?: string) => targetId && onChange({ op: "task.move", id: task.id, targetId, date }, "순서를 변경했어요.");
  const dragging = draggedTask?.id === task.id;
  const canDrop = reorderable && !readOnly && !busy && draggedTask && !dragging && draggedTask.done === task.done && draggedTask.date <= date && (draggedTask.endDate ?? draggedTask.date) >= date;
  const startEditing = () => { setTitle(task.title); setStart(task.date); setEnd(task.endDate ?? task.date); setEditing(true); setMenu(false); };
  const childComposer = !readOnly && (addingChild ? <form className="subtask-form subtask-add" onSubmit={async event => {
    event.preventDefault();
    if (await onChange({ op: childDate ? "subtask.add" : "backlog.add", taskId: task.id, title: childTitle, date: childDate || undefined })) { setChildTitle(""); setAddingChild(false); }
  }}>
    <input autoFocus value={childTitle} onChange={event => setChildTitle(event.target.value)} placeholder="하위 할 일" aria-label={`${task.title} 하위 할 일 추가`} maxLength={240} required disabled={busy} />
    <label className="subtask-date-picker">날짜 (선택)<input type="date" value={childDate} min={task.date} max={task.endDate ?? task.date} onChange={event => setChildDate(event.target.value)} aria-label="하위 할 일 날짜, 비우면 날짜 미정" disabled={busy} /></label>
    <button className="text-button" disabled={busy || !childTitle.trim()}>추가</button><button type="button" className="icon-button" aria-label="하위 할 일 추가 닫기" disabled={busy} onClick={() => setAddingChild(false)}><X size={12} /></button>
  </form> : <button className="text-button subtask-add-toggle" disabled={busy} onClick={() => { setChildDate(""); setAddingChild(true); }}>＋ 하위 할 일</button>);

  return <li className={`task-item task-color ${task.projectId ? "" : "task-unassigned"} ${children.length || task.endDate ? "task-family" : ""} ${dragging ? "task-drag-source" : ""} ${canDrop && dropPosition ? `task-drop-${dropPosition}` : ""}`} style={{ "--task-hue": taskHue(task) } as CSSProperties}
    onDragOver={event => {
      if (!canDrop) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      const bounds = event.currentTarget.getBoundingClientRect();
      setDropPosition(event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPosition(null); }}
    onDrop={event => {
      if (!canDrop || !dropPosition) return;
      event.preventDefault();
      void onChange({ op: "task.move", id: draggedTask.id, targetId: task.id, position: dropPosition, date }, "순서를 변경했어요.");
      setDropPosition(null); onDragEnd();
    }}>
    {!readOnly && task.projectId && <div className="task-project-header">
      <label className="task-project-picker"><span className="project-color-dot" aria-hidden="true" /><select aria-label={`${task.title} 프로젝트`} value={task.projectId ?? ""} disabled={busy} onChange={event => void onChange({ op: "task.link", taskId: task.id, artifactId: event.target.value || null })}>
        <option value="">프로젝트 연결 해제</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select></label>
      {onOpenWorkLog && <button className="text-button" onClick={() => onOpenWorkLog(task)}><FolderOpen size={12} />기록 보기</button>}
    </div>}
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      {reorderable && !readOnly && !editing && <button className="icon-button task-order-handle" draggable={!busy} disabled={busy}
        aria-label={`${task.title} 순서 변경, 위아래 방향키로 이동`} title="드래그하거나 ↑ ↓ 키로 순서 변경"
        onDragStart={event => {
          const card = event.currentTarget.closest("li")!;
          const bounds = card.getBoundingClientRect();
          const preview = card.cloneNode(true) as HTMLElement;
          preview.classList.add("task-drag-preview");
          Object.assign(preview.style, { width: `${bounds.width}px`, left: `${bounds.left}px`, top: `${bounds.top}px` });
          preview.setAttribute("aria-hidden", "true");
          document.body.appendChild(preview);
          event.dataTransfer.setData("application/x-daylight-task", task.id); event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setDragImage(preview, event.clientX - bounds.left, event.clientY - bounds.top);
          requestAnimationFrame(() => preview.remove());
          setMenu(false); onDragStart();
        }}
        onDragEnd={() => { setDropPosition(null); onDragEnd(); }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); void move(event.key === "ArrowUp" ? previousTaskId : nextTaskId); } }}><GripVertical size={14} /></button>}
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
      {children.length > 0 && <ul>{children.map((child, index) => <li key={child.id} className={`subtask-row ${child.date === date ? "subtask-today" : ""}`}>
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
          {!readOnly && <span className="subtask-order-actions">
            <button className="icon-button" aria-label={`${child.title} 위로 이동`} title="위로 이동" disabled={busy || !children[index - 1] || children[index - 1].done !== child.done} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: children[index - 1].id, date }, "순서를 변경했어요.")}><ArrowUp size={12} /></button>
            <button className="icon-button" aria-label={`${child.title} 아래로 이동`} title="아래로 이동" disabled={busy || !children[index + 1] || children[index + 1].done !== child.done} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: children[index + 1].id, date }, "순서를 변경했어요.")}><ArrowDown size={12} /></button>
          </span>}
          {!readOnly && <><button className="icon-button" aria-label={`${child.title} 수정`} disabled={busy} onClick={() => setEditChild({ ...child })}><Pencil size={12} /></button><button className="icon-button" aria-label={`${child.title} 삭제`} disabled={busy} onClick={() => onDelete(task, child)}><Trash2 size={12} /></button></>}
        </>}
      </li>)}</ul>}
      {!readOnly && backlog.length > 0 && onDeleteBacklog && <div className="subtask-backlog"><span className="tiny muted">날짜 미정</span><PlannerBacklog items={backlog} date={date} busy={busy} showParent={false} onChange={onChange} onDelete={onDeleteBacklog} /></div>}
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
  return <li className={`task-item daily-subtask-row task-color ${task.projectId ? "" : "task-unassigned"}`} style={{ "--task-hue": taskHue(task) } as CSSProperties}>
    {task.projectTitle && <div className="daily-task-project"><span className="project-color-dot" aria-hidden="true" />{task.projectTitle}</div>}
    <div className={`task-row ${child.done ? "is-done" : ""}`}>
      <button className={`task-check ${child.done ? "checked" : ""}`} disabled={busy} aria-label={`${child.title} ${child.done ? "완료 취소" : "완료"}`} onClick={() => void onChange({ op: "subtask.patch", id: child.id, done: !child.done })}>{child.done ? <Check size={13} strokeWidth={3} /> : null}</button>
      <div className="task-content"><button className="task-title task-title-edit" disabled={busy} onClick={() => onOpenTask(task, child.id)}>{child.title}</button><button className="daily-parent-link" disabled={busy} onClick={() => onOpenTask(task)}>{task.title}</button></div>
      <div className="task-actions">
        <span className="subtask-order-actions"><button className="icon-button" aria-label={`${child.title} 위로 이동`} disabled={busy || !siblings[index - 1]} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: siblings[index - 1].id, date }, "순서를 변경했어요.")}><ArrowUp size={12} /></button><button className="icon-button" aria-label={`${child.title} 아래로 이동`} disabled={busy || !siblings[index + 1]} onClick={() => void onChange({ op: "subtask.move", id: child.id, targetId: siblings[index + 1].id, date }, "순서를 변경했어요.")}><ArrowDown size={12} /></button></span>
        <button className="icon-button" aria-label={`${child.title} 수정`} disabled={busy} onClick={() => onOpenTask(task, child.id)}><Pencil size={13} /></button><button className="icon-button" aria-label={`${child.title} 삭제`} disabled={busy} onClick={() => onDelete(task, child)}><Trash2 size={13} /></button>
      </div>
    </div>
  </li>;
}
