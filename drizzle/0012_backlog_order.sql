ALTER TABLE task_backlog ADD sort_order integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id,task_id ORDER BY created_at,rowid) AS position
  FROM task_backlog
)
UPDATE task_backlog SET sort_order=(
  CASE WHEN task_id IS NULL
    THEN (SELECT COALESCE(MAX(sort_order),0) FROM tasks WHERE owner_id=task_backlog.owner_id)
    ELSE (SELECT COALESCE(MAX(sort_order),0) FROM task_subtasks WHERE task_id=task_backlog.task_id)
  END
) + (SELECT position FROM ranked WHERE ranked.id=task_backlog.id);
