CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`date` integer,
	`level` integer,
	`sticky` integer
);
--> statement-breakpoint
CREATE TABLE `configs` (
	`uid` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	FOREIGN KEY (`uid`) REFERENCES `users`(`uid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leaderboard_entries` (
	`mode` text NOT NULL,
	`mode2` text NOT NULL,
	`language` text NOT NULL,
	`uid` text NOT NULL,
	`wpm` real NOT NULL,
	`acc` real NOT NULL,
	`raw` real NOT NULL,
	`consistency` real NOT NULL,
	`timestamp` integer NOT NULL,
	PRIMARY KEY(`mode`, `mode2`, `language`, `uid`),
	FOREIGN KEY (`uid`) REFERENCES `users`(`uid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leaderboard_rank` ON `leaderboard_entries` (`mode`,`mode2`,`language`,"wpm" desc,"acc" desc,`timestamp`);--> statement-breakpoint
CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`name` text NOT NULL,
	`setting_groups` text,
	`config` text NOT NULL,
	FOREIGN KEY (`uid`) REFERENCES `users`(`uid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `presets_uid` ON `presets` (`uid`);--> statement-breakpoint
CREATE TABLE `public_stats` (
	`id` integer PRIMARY KEY NOT NULL,
	`tests_completed` integer DEFAULT 0 NOT NULL,
	`tests_started` integer DEFAULT 0 NOT NULL,
	`time_typing` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quote_ratings` (
	`language` text NOT NULL,
	`quote_id` integer NOT NULL,
	`ratings` integer NOT NULL,
	`total_rating` integer NOT NULL,
	PRIMARY KEY(`language`, `quote_id`)
);
--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`timestamp` integer NOT NULL,
	`mode` text NOT NULL,
	`mode2` text NOT NULL,
	`language` text NOT NULL,
	`wpm` real NOT NULL,
	`acc` real NOT NULL,
	`is_pb` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`chart_data` text,
	`key_spacing_stats` text,
	`key_duration_stats` text,
	FOREIGN KEY (`uid`) REFERENCES `users`(`uid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `results_uid_timestamp` ON `results` (`uid`,`timestamp`);--> statement-breakpoint
CREATE TABLE `users` (
	`uid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`added_at` integer NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`lb_opt_out` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`needs_to_change_name` integer DEFAULT false NOT NULL,
	`last_name_change` integer,
	`xp` integer DEFAULT 0 NOT NULL,
	`started_tests` integer DEFAULT 0 NOT NULL,
	`completed_tests` integer DEFAULT 0 NOT NULL,
	`time_typing` real DEFAULT 0 NOT NULL,
	`personal_bests` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`custom_themes` text DEFAULT '[]' NOT NULL,
	`result_filter_presets` text DEFAULT '[]' NOT NULL,
	`streak` text,
	`test_activity` text DEFAULT '{}' NOT NULL,
	`lb_memory` text,
	`favorite_quotes` text,
	`quote_ratings` text,
	`profile_details` text,
	`last_result_hashes` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_lower` ON `users` (lower("name"));