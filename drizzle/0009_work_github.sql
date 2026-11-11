CREATE TABLE `work_github_connections` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`repository` text NOT NULL,
	`branch` text NOT NULL,
	`token_cipher` text NOT NULL,
	`connected_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `work_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_github_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`repository` text NOT NULL,
	`commit_sha` text NOT NULL,
	`path` text NOT NULL,
	`digest` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `work_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_github_version_content` ON `work_github_versions` (`entry_id`,`repository_id`,`digest`);--> statement-breakpoint
CREATE INDEX `work_github_versions_entry` ON `work_github_versions` (`owner_id`,`entry_id`,`saved_at`);