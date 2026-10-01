import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Aggregate revision protects transactional supply/demand changes from concurrent writers.
export const workspaces = sqliteTable('wip_workspaces', {
  id: text('id').primaryKey(), revision: integer('revision').notNull(),
  state: text('state_json').notNull(), updatedAt: text('updated_at').notNull(),
});
export const events = sqliteTable('wip_events', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(),
  eventKey: text('event_key').notNull(), kind: text('kind').notNull(),
  payload: text('payload_json').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('wip_event_dedup').on(t.workspaceId, t.eventKey)]);
export const runs = sqliteTable('wip_runs', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(),
  runKey: text('run_key').notNull(), status: text('status').notNull(),
  result: text('result_json').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('wip_run_dedup').on(t.workspaceId, t.runKey)]);
