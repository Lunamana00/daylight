# daylight

Set your own daily tasks. See what other people plan and complete.

- **서로의 오늘** shows each person's tasks and completion state.
- **내 할 일** shows your tasks first and the weekly calendar below them. Add, edit, complete, delete, or move your own tasks to the next day. Select a date in the calendar to show that day's tasks. Other people cannot change your tasks.
- Select **여러 날** to set a start date and an end date. Add dated subtasks under the task. The task appears on each date in its period. Complete each subtask to update total progress.
- The calendar opens in **주간** view. It shows task periods above the dated tasks and subtasks. Use the checkboxes to complete them. Select **월간** for a month overview. The calendar shows your Google events and daily tasks. Only your account can read your calendar events. They do not become daily tasks.
- Google sign-in permits invited accounts only. The Mac widget uses the same account and server.

## Google Calendar and the Mac widget

Select one or more calendars in **설정**. The server reads the selected calendars every five minutes. Use **지금 동기화** or the refresh button in the Mac widget to request an update. Failed imports keep the last saved events. Task records and saved event order remain unchanged.

The Mac widget shows today’s tasks, including subtasks scheduled for today. The header shows the full completion count. Use **Edit Widget** to show or hide Google Calendar events.

See [deployment instructions](deploy/README.md) for Google login, database setup, and Mac installation.

## Original Sites deployment

The original Sites deployment uses Sign in with ChatGPT and dots. Its database and access settings remain separate from the Google deployment. Keep its project ID and configuration in `.openai/hosting.json`. Do not apply the Google database changes to the Sites database.

The original MCP tools are `get_daily_plan`, `list_milestones`, and `sync_google_calendar_milestones`. They cannot change daily tasks. Calendar imports require a complete successful read of the selected calendar. They do not write to Google Calendar.

## Local development

Use Node.js 24 or later. Keep the lock file and install dependencies with `npm ci`.

```sh
npm run dev -- --hostname 127.0.0.1 --port 5173
```

Apply the SQL files in `drizzle/` once, in order, to the local database. The generated local database configuration is `dist/server/wrangler.json`. Local records are separate from production records.

Build the deployment with `npm run build`. Planner checks are in `scripts/check-planner.mjs`. Calendar access and sync checks are in `scripts/check-calendar-sync.mjs`.
