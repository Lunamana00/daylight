CREATE TABLE `work_file_chunks` (
	`file_id` text NOT NULL,
	`position` integer NOT NULL,
	`content` blob NOT NULL,
	PRIMARY KEY(`file_id`, `position`),
	FOREIGN KEY (`file_id`) REFERENCES `work_files`(`id`) ON UPDATE no action ON DELETE cascade
);
