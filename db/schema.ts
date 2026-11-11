import { sqliteTable, text, integer, blob, primaryKey, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  joinedAt: text("joined_at").notNull(),
});
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => members.id),
  date: text("date").notNull(),
  endDate: text("end_date"),
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  important: integer("important").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("tasks_day_owner").on(table.date, table.ownerId)]);
export const taskSubtasks = sqliteTable("task_subtasks", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("subtasks_parent_date").on(table.taskId, table.date)]);
export const notes = sqliteTable("notes", {
  ownerId: text("owner_id").notNull().references(() => members.id),
  date: text("date").notNull(),
  content: text("content").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.date] })]);
export const calendarSources = sqliteTable("calendar_sources", {
  ownerId: text("owner_id").notNull().references(() => members.id),
  calendarId: text("calendar_id").primaryKey(),
  name: text("name").notNull(),
  syncedAt: text("synced_at").notNull(),
});
export const milestones = sqliteTable("milestones", {
  ownerId: text("owner_id").notNull().references(() => members.id),
  calendarId: text("calendar_id").notNull(),
  eventId: text("event_id").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  url: text("url"),
  syncedAt: text("synced_at").notNull(),
}, table => [primaryKey({ columns: [table.calendarId, table.eventId] }), index("milestones_date").on(table.date)]);

// Kept separately so refreshing a calendar snapshot preserves the team's order.
export const milestoneOrder = sqliteTable("milestone_order", {
  calendarId: text("calendar_id").notNull(),
  eventId: text("event_id").notNull(),
  position: integer("position").notNull(),
}, table => [primaryKey({ columns: [table.calendarId, table.eventId] })]);

export const workArtifacts = sqliteTable("work_artifacts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => members.id),
  title: text("title").notNull(), description: text("description").notNull().default(""), url: text("url"),
  colorHue: integer("color_hue"),
  background: text("background").notNull().default(""), contribution: text("contribution").notNull().default(""),
  decisions: text("decisions").notNull().default(""), results: text("results").notNull().default(""), reflection: text("reflection").notNull().default(""),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [index("work_artifacts_owner").on(table.ownerId, table.updatedAt)]);
export const workTaskLinks = sqliteTable("work_task_links", {
  taskId: text("task_id").primaryKey().references(() => tasks.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull().references(() => workArtifacts.id),
  stageId: text("stage_id").references(() => workStages.id),
}, table => [index("work_tasks_artifact").on(table.artifactId)]);
export const workEntries = sqliteTable("work_entries", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => members.id),
  artifactId: text("artifact_id").references(() => workArtifacts.id),
  stageId: text("stage_id").references(() => workStages.id),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  subtaskId: text("subtask_id").references(() => taskSubtasks.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["plan", "decision", "progress", "result"] }).notNull(),
  title: text("title").notNull(), body: text("body").notNull().default(""), links: text("links").notNull().default("[]"),
  provider: text("provider", { enum: ["manual", "daylight", "codex", "chatgpt"] }).notNull(),
  scope: text("scope").notNull().default(""), sourceKey: text("source_key").notNull(), sourceUrl: text("source_url"),
  occurredAt: text("occurred_at").notNull(), createdAt: text("created_at").notNull(),
  featured: integer("featured").notNull().default(0), hidden: integer("hidden").notNull().default(0),
}, table => [uniqueIndex("work_entries_source").on(table.ownerId, table.provider, table.scope, table.sourceKey), index("work_entries_timeline").on(table.ownerId, table.artifactId, table.occurredAt, table.id), check("work_entries_kind", sql`${table.kind} IN ('plan','decision','progress','result')`), check("work_entries_provider", sql`${table.provider} IN ('manual','daylight','codex','chatgpt')`)]);
export const workConnections = sqliteTable("work_connections", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => members.id),
  artifactId: text("artifact_id").notNull().references(() => workArtifacts.id),
  provider: text("provider", { enum: ["codex", "chatgpt"] }).notNull(), scope: text("scope").notNull(),
  tokenHash: text("token_hash").notNull().unique(), createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(), lastSyncAt: text("last_sync_at"), revokedAt: text("revoked_at"),
}, table => [uniqueIndex("work_connections_source").on(table.ownerId, table.provider, table.scope), check("work_connections_provider", sql`${table.provider} IN ('codex','chatgpt')`)]);
export const workStages = sqliteTable("work_stages", {
  id: text("id").primaryKey(), artifactId: text("artifact_id").notNull().references(() => workArtifacts.id),
  title: text("title").notNull(), position: integer("position").notNull(),
  status: text("status", { enum: ["planned", "active", "done"] }).notNull().default("planned"),
}, table => [index("work_stages_artifact").on(table.artifactId, table.position), check("work_stages_status", sql`${table.status} IN ('planned','active','done')`)]);
export const workFiles = sqliteTable("work_files", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => members.id),
  entryId: text("entry_id").notNull().references(() => workEntries.id), objectKey: text("object_key").notNull().unique(),
  checksum: text("checksum").notNull(),
  fileName: text("file_name").notNull(), contentType: text("content_type").notNull(), size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("work_files_entry").on(table.entryId), uniqueIndex("work_files_content").on(table.entryId, table.checksum)]);

export const workFileChunks = sqliteTable("work_file_chunks", {
  fileId: text("file_id").notNull().references(() => workFiles.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  content: blob("content", { mode: "buffer" }).notNull(),
}, table => [primaryKey({ columns: [table.fileId, table.position] })]);
