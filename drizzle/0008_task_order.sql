ALTER TABLE `task_subtasks` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at,rowid) AS position FROM tasks
)
UPDATE tasks SET sort_order=(SELECT position FROM ranked WHERE ranked.id=tasks.id);--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY date,created_at,rowid) AS position FROM task_subtasks
)
UPDATE task_subtasks SET sort_order=(SELECT position FROM ranked WHERE ranked.id=task_subtasks.id);
