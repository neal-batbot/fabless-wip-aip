CREATE TABLE `wip_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`event_key` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wip_event_dedup` ON `wip_events` (`workspace_id`,`event_key`);--> statement-breakpoint
CREATE TABLE `wip_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_key` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wip_run_dedup` ON `wip_runs` (`workspace_id`,`run_key`);--> statement-breakpoint
CREATE TABLE `wip_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
