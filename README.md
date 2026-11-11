# daylight

Set your own daily tasks. See what other people plan and complete.

- **서로의 오늘** shows each person's tasks and completion state.
- **내 할 일** opens with **작업·오늘 분할형**. The left pane holds long work and parent tasks. The right pane shows tasks and subtasks scheduled for the selected day. Select a title to edit it. The weekly calendar stays below the task area. Other people cannot change your tasks.
- Use **보기** to select **목록 전환형**. Switch between the selected day and **전체 작업**. The full list includes your past and future work. Completed work is at the bottom. The browser remembers the layout. On a small screen, the split panes use one column.
- Press Command+Enter in the new-task form to add a task. Press Enter in the title field to add a new line.
- Set a start date and an end date in the task form. The calendar shows the full period. Select the period bar in the weekly calendar to edit the task or add dated subtasks. Only subtasks scheduled for the selected day appear in the daily list and Mac widget. A period without subtasks does not count as a daily task. Complete each subtask to update total progress.
- Completed tasks move to the bottom. Drag the handle to change task order. The full card follows the pointer. A blue line shows where it will go. You can also use the arrow keys on the handle or the move commands in the task menu. Use the arrow buttons to move subtasks. The server saves the order. The calendar and Mac widget use this order. If you undo completion, the task returns to its saved position.
- The calendar opens in **주간** view. It shows task periods above the dated tasks and subtasks. Use the checkboxes to complete them. Select **월간** for a month overview. The calendar shows your Google events and daily tasks. Only your account can read your calendar events. They do not become daily tasks.
- Google sign-in permits invited accounts only. The Mac widget uses the same account and server.

## Google Calendar and the Mac widget

Select one or more calendars in **설정**. The server reads the selected calendars every five minutes. Use **지금 동기화** or the refresh button in the Mac widget to request an update. Failed imports keep the last saved events. Task records and saved event order remain unchanged.

The Mac widget shows today’s tasks, including subtasks scheduled for today. The header shows the full completion count. Use **Edit Widget** to show or hide Google Calendar events.

Download the [Mac installer](https://github.com/Lunamana00/daylight/releases/tag/v1.1.0-beta.1) and follow the [installation guide](docs/mac-install.md). The installer requires macOS 26 or later. It supports Apple Silicon and Intel. You do not need Xcode or a GitHub account. This beta uses a development signature. Apple has not notarized it.

See [deployment instructions](deploy/README.md) for Google login, database setup, and source builds.

## Work records

Open **작업물** to create a project and set its goal and work stages. Add dated records, PDF reports, and images to each stage. Select a project when you add a task. For an existing task without a project, open its menu and select **프로젝트 연결**. Assigned project names appear above task titles in the list and calendar. Use the selector above a task to change or remove its project. Tasks and subtasks use the same project color in the list and calendar. The area below the calendar shows each project's task count and completion count. Use **기록 보기** to open the linked project. Completion changes appear in that project's history. Select records with the star for a portfolio export.

The interface uses neutral surfaces and dark task text. Project colors appear in small dots, edge lines, and progress bars. They do not fill task cards.

Work records and attachments are private to their owner. Connect a private GitHub repository in the project. Enter a record and attach reports or images. Select **GitHub에 저장** to save the record and files as one version. Open a saved version from daylight. Earlier versions stay in GitHub. ChatGPT and Codex collection is disabled. See [work records](docs/work-log.md) for setup.

The database keeps your editable records and attachments. A failed GitHub save does not remove them. Existing records are not sent to GitHub until you select **GitHub에 저장**. An R2 subscription is not necessary. Each file can be up to 10 MB. Uploads stop when total database attachments reach 200 MB.

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
