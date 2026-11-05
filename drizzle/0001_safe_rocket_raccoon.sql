PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_calendar_sources` (
	`owner_id` text NOT NULL,
	`calendar_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_calendar_sources`("owner_id", "calendar_id", "name", "synced_at") SELECT "owner_id", "calendar_id", "name", "synced_at" FROM `calendar_sources`;--> statement-breakpoint
DROP TABLE `calendar_sources`;--> statement-breakpoint
ALTER TABLE `__new_calendar_sources` RENAME TO `calendar_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_milestones` (
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`url` text,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`calendar_id`, `event_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_milestones`("owner_id", "calendar_id", "event_id", "title", "date", "url", "synced_at") SELECT "owner_id", "calendar_id", "event_id", "title", "date", "url", "synced_at" FROM `milestones`;--> statement-breakpoint
DROP TABLE `milestones`;--> statement-breakpoint
ALTER TABLE `__new_milestones` RENAME TO `milestones`;--> statement-breakpoint
CREATE INDEX `milestones_date` ON `milestones` (`date`);