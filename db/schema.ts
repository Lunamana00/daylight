import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

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
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  important: integer("important").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("tasks_day_owner").on(table.date, table.ownerId)]);
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
