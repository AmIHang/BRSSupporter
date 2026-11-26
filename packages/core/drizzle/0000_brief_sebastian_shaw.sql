CREATE TABLE `applications` (
	`name` text PRIMARY KEY NOT NULL,
	`short_name` text,
	`customer` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`name` text PRIMARY KEY NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`application_name` text NOT NULL,
	`name` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`first_seen_at` text NOT NULL,
	PRIMARY KEY(`application_name`, `name`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`number` text PRIMARY KEY NOT NULL,
	`summary` text,
	`status` text NOT NULL,
	`application_name` text,
	`project_name` text,
	`category_name` text,
	`reporter` text,
	`handler` text,
	`link` text,
	`create_date` text NOT NULL,
	`change_date` text NOT NULL,
	`data` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`gone_at` text
);
