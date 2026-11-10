CREATE TABLE `work_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_artifacts_owner` ON `work_artifacts` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `work_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`provider` text NOT NULL,
	`scope` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_sync_at` text,
	`revoked_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `work_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_connections_provider" CHECK("work_connections"."provider" IN ('codex','chatgpt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_connections_token_hash_unique` ON `work_connections` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `work_connections_source` ON `work_connections` (`owner_id`,`provider`,`scope`);--> statement-breakpoint
CREATE TABLE `work_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`artifact_id` text,
	`stage_id` text,
	`task_id` text,
	`subtask_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`provider` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`source_key` text NOT NULL,
	`source_url` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `work_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `work_stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subtask_id`) REFERENCES `task_subtasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "work_entries_kind" CHECK("work_entries"."kind" IN ('plan','decision','progress','result')),
	CONSTRAINT "work_entries_provider" CHECK("work_entries"."provider" IN ('manual','daylight','codex','chatgpt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_entries_source` ON `work_entries` (`owner_id`,`provider`,`scope`,`source_key`);--> statement-breakpoint
CREATE INDEX `work_entries_timeline` ON `work_entries` (`owner_id`,`artifact_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `work_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`object_key` text NOT NULL,
	`checksum` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `work_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_files_object_key_unique` ON `work_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `work_files_entry` ON `work_files` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `work_files_content` ON `work_files` (`entry_id`,`checksum`);--> statement-breakpoint
CREATE TABLE `work_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `work_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_stages_status" CHECK("work_stages"."status" IN ('planned','active','done'))
);
--> statement-breakpoint
CREATE INDEX `work_stages_artifact` ON `work_stages` (`artifact_id`,`position`);--> statement-breakpoint
CREATE TABLE `work_task_links` (
	`task_id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`stage_id` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `work_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `work_stages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_tasks_artifact` ON `work_task_links` (`artifact_id`);
--> statement-breakpoint
-- Completion history uses actual changes, including changes made by the Mac widget.
CREATE TRIGGER work_task_completion AFTER UPDATE OF done ON tasks
WHEN OLD.done <> NEW.done
BEGIN
  INSERT INTO work_entries (id,owner_id,artifact_id,stage_id,task_id,kind,title,provider,source_key,occurred_at,created_at)
  SELECT lower(hex(randomblob(16))),NEW.owner_id,l.artifact_id,l.stage_id,NEW.id,
    CASE WHEN NEW.done=1 THEN 'result' ELSE 'progress' END,
    CASE WHEN NEW.done=1 THEN '할 일 완료 · ' ELSE '할 일 다시 시작 · ' END || NEW.title,
    'daylight',lower(hex(randomblob(16))),NEW.updated_at,NEW.updated_at
  FROM work_task_links l JOIN work_artifacts a ON a.id=l.artifact_id
  WHERE l.task_id=NEW.id AND a.owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER work_subtask_completion AFTER UPDATE OF done ON task_subtasks
WHEN OLD.done <> NEW.done
BEGIN
  INSERT INTO work_entries (id,owner_id,artifact_id,stage_id,task_id,subtask_id,kind,title,provider,source_key,occurred_at,created_at)
  SELECT lower(hex(randomblob(16))),t.owner_id,l.artifact_id,l.stage_id,t.id,NEW.id,
    CASE WHEN NEW.done=1 THEN 'result' ELSE 'progress' END,
    CASE WHEN NEW.done=1 THEN '하위 할 일 완료 · ' ELSE '하위 할 일 다시 시작 · ' END || NEW.title,
    'daylight',lower(hex(randomblob(16))),NEW.updated_at,NEW.updated_at
  FROM tasks t JOIN work_task_links l ON l.task_id=t.id JOIN work_artifacts a ON a.id=l.artifact_id
  WHERE t.id=NEW.task_id AND a.owner_id=t.owner_id;
END;
