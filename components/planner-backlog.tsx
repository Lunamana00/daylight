"use client";

import { useState } from "react";
import { CalendarDays, Pencil, Trash2, X } from "lucide-react";
import { today, type BacklogItem } from "../lib/planner-core";

type Props = {
  items: BacklogItem[]; date: string; busy: boolean; showParent?: boolean;
  onChange: (input: Record<string, unknown>, message?: string) => Promise<boolean>;
  onDelete: (item: BacklogItem) => void;
};
export function PlannerBacklog({ items, ...props }: Props) {
  return <ul className="backlog-list">{items.map(item => <BacklogRow key={item.id} item={item} {...props} />)}</ul>;
}
function BacklogRow({ item, date, busy, showParent = true, onChange, onDelete }: Omit<Props, "items"> & { item: BacklogItem }) {
  const [editing, setEditing] = useState<"title" | "date" | null>(null);
  const [title, setTitle] = useState(item.title);
  const [scheduledDate, setScheduledDate] = useState(date < (item.taskDate ?? date) ? item.taskDate! : date > (item.taskEndDate ?? date) ? item.taskEndDate! : date);
  const currentDay = today();
  const canScheduleToday = !item.taskId || currentDay >= item.taskDate! && currentDay <= item.taskEndDate!;
  return <li className="backlog-row">
    {editing ? <form className="backlog-edit" onSubmit={async event => {
      event.preventDefault();
      const input = editing === "title" ? { op: "backlog.patch", id: item.id, title } : { op: "backlog.schedule", id: item.id, date: scheduledDate };
      if (await onChange(input, editing === "date" ? "날짜를 정해 할 일에 추가했어요." : undefined)) setEditing(null);
    }}>
      {editing === "title" ? <input autoFocus aria-label="날짜 미정 할 일 제목" value={title} maxLength={240} required disabled={busy} onChange={event => setTitle(event.target.value)} /> : <label>할 날짜<input autoFocus aria-label={`${item.title} 할 날짜`} type="date" min={item.taskDate ?? "2000-01-01"} max={item.taskEndDate ?? "2100-09-01"} value={scheduledDate} required disabled={busy} onChange={event => setScheduledDate(event.target.value)} /></label>}
      <button className="text-button" disabled={busy}>{editing === "date" ? "날짜 지정" : "저장"}</button><button className="icon-button" type="button" disabled={busy} aria-label="취소" onClick={() => setEditing(null)}><X size={13} /></button>
    </form> : <>
      <div className="backlog-content">{showParent && item.projectTitle && <small>{item.projectTitle}</small>}<span>{item.title}</span>{showParent && item.taskTitle && <small>{item.taskTitle}</small>}</div>
      <div className="backlog-actions"><button className="text-button" disabled={busy || !canScheduleToday} title={canScheduleToday ? "오늘 할 일로 옮기기" : "상위 작업의 기간 밖이에요. 날짜 지정에서 선택해 주세요."} onClick={() => void onChange({ op: "backlog.schedule", id: item.id, date: currentDay }, "오늘 할 일에 추가했어요.")}>오늘</button>
        <button className="icon-button" aria-label={`${item.title} 날짜 지정`} title="날짜 지정" disabled={busy} onClick={() => setEditing("date")}><CalendarDays size={14} /></button>
        <button className="icon-button" aria-label={`${item.title} 수정`} disabled={busy} onClick={() => { setTitle(item.title); setEditing("title"); }}><Pencil size={13} /></button>
        <button className="icon-button" aria-label={`${item.title} 삭제`} disabled={busy} onClick={() => onDelete(item)}><Trash2 size={13} /></button>
      </div>
    </>}
  </li>;
}
