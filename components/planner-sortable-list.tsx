"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function PlannerSortableList({ children, className, disabled = false, onMove, onDraggingChange }: {
  children: ReactNode; className?: string; disabled?: boolean;
  onMove: (id: string, targetId: string, position: "before" | "after") => unknown;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const source = useRef<HTMLElement | null>(null);
  const target = useRef<HTMLElement | null>(null);
  function clearTarget() {
    target.current?.classList.remove("task-drop-before", "task-drop-after");
    target.current = null;
  }
  function finish() {
    source.current?.classList.remove("task-drag-source");
    source.current = null;
    clearTarget();
    onDraggingChange?.(false);
  }
  useEffect(() => () => {
    source.current?.classList.remove("task-drag-source");
    target.current?.classList.remove("task-drop-before", "task-drop-after");
    onDraggingChange?.(false);
  }, [onDraggingChange]);
  function rowAt(value: EventTarget | null) {
    let row = value instanceof Element ? value.closest<HTMLElement>("li[data-sort-id]") : null;
    while (row && row.parentElement !== list.current) row = row.parentElement?.closest<HTMLElement>("li[data-sort-id]") ?? null;
    return row;
  }
  const sameGroup = (a: HTMLElement, b: HTMLElement) => a.dataset.sortGroup === b.dataset.sortGroup && a.dataset.sortDone === b.dataset.sortDone;
  const positionAt = (row: HTMLElement, y: number) => {
    const bounds = row.getBoundingClientRect();
    return y < bounds.top + bounds.height / 2 ? "before" : "after";
  };
  return <ul ref={list} className={`sortable-list ${className ?? ""}`}
    onDragStart={event => {
      if (disabled || !(event.target instanceof Element) || !event.target.closest("[data-sort-handle]")) return;
      const row = rowAt(event.target);
      if (!row) return;
      event.stopPropagation();
      const bounds = row.getBoundingClientRect();
      const preview = row.cloneNode(true) as HTMLElement;
      preview.classList.add("task-drag-preview");
      Object.assign(preview.style, { width: `${bounds.width}px`, left: `${bounds.left}px`, top: `${bounds.top}px` });
      preview.setAttribute("aria-hidden", "true");
      document.body.appendChild(preview);
      event.dataTransfer.setData("application/x-daylight-task", row.dataset.sortId!);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(preview, event.clientX - bounds.left, event.clientY - bounds.top);
      requestAnimationFrame(() => preview.remove());
      source.current = row;
      row.classList.add("task-drag-source");
      onDraggingChange?.(true);
    }}
    onDragOver={event => {
      if (!source.current) return;
      event.stopPropagation();
      const row = rowAt(event.target);
      clearTarget();
      if (disabled || !row || row === source.current || !sameGroup(source.current, row)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      target.current = row;
      row.classList.add(`task-drop-${positionAt(row, event.clientY)}`);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearTarget(); }}
    onDrop={event => {
      if (!source.current) return;
      event.stopPropagation(); event.preventDefault();
      const row = rowAt(event.target);
      if (!disabled && row && row !== source.current && sameGroup(source.current, row)) {
        void onMove(source.current.dataset.sortId!, row.dataset.sortId!, positionAt(row, event.clientY));
      }
      finish();
    }}
    onDragEnd={event => { if (source.current) { event.stopPropagation(); finish(); } }}
    onKeyDown={event => {
      if (disabled || !["ArrowUp", "ArrowDown"].includes(event.key) || !(event.target instanceof Element) || !event.target.closest("[data-sort-handle]")) return;
      const row = rowAt(event.target);
      if (!row) return;
      event.stopPropagation(); event.preventDefault();
      const siblings = Array.from(event.currentTarget.children).filter((item): item is HTMLElement => item instanceof HTMLElement && Boolean(item.dataset.sortId) && sameGroup(row, item));
      const next = siblings[siblings.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) void onMove(row.dataset.sortId!, next.dataset.sortId!, event.key === "ArrowUp" ? "before" : "after");
    }}>
    {children}
  </ul>;
}
