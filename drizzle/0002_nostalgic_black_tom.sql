CREATE TABLE `milestone_order` (
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`calendar_id`, `event_id`)
);
