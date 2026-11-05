CREATE TABLE `calendar_sources` (
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `calendar_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`joined_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`url` text,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `calendar_id`, `event_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `milestones_date` ON `milestones` (`date`);--> statement-breakpoint
CREATE TABLE `notes` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`important` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_day_owner` ON `tasks` (`date`,`owner_id`);