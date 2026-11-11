# Work records and outputs

A project has a goal and ordered stages. Add your own dated records, links, PDF reports, and images. Link a record to a daily task when needed.

The **작업물** screen has three tabs:

- **흐름** shows stage status and dated records.
- **자료** shows files and links in the selected project.
- **정리** holds the goal, background, contribution, decisions, results, and reflection. Empty fields stay out of the read view and export.

Task completion history stays in daylight. ChatGPT and Codex collection is disabled. The app does not collect conversations or copy project folders.

## Connect GitHub

1. Create a private repository in your GitHub account. Add a README when you create it. Use a separate repository for work records.
2. Open a project in daylight. Expand **GitHub 저장소 연결**.
3. Select **GitHub에서 연결 토큰 만들기**. In GitHub, select your account and **Only select repositories**. Select the records repository. Give it **Contents: Read and write** permission. Keep an expiration date.
4. Copy the fine-grained token into the password field in daylight. Enter the repository URL. Select **연결**.

The Worker verifies repository ownership and private access. It encrypts the token before it saves the connection. The token is not returned to the browser. Each project has its own connection. Projects can use the same repository.

When the token expires, create a new token and connect the project again. Disconnect the old connection first. Disconnecting removes the stored token. It does not delete GitHub records. You can also revoke the token in GitHub.

## Save a record

Enter a record and attach the outputs. Select **GitHub에 저장**. The app first keeps the record and files in daylight. It then saves a GitHub version. If GitHub fails, use **저장 다시 시도**. Your input stays in daylight.

For an existing record, select **GitHub에 저장** on its card. After you change a record, its files, or its associations, select **GitHub에 저장** again. Saved versions show their dates and links on the card. Each link opens that exact version in GitHub. You must have access to the private repository to open it.

Each version contains:

- `README.md`: the project summary, stages, record, and relative attachment links.
- `record.json`: the same information in a structured format, with file checksums.
- `files/`: the attached PDF and image files.

The path is `daylight/PROJECT_ID/RECORD_ID/CONTENT_HASH/`. New content has a new path. A repeated save with unchanged content does not make another version. The app preserves other repository files and does not force-push. A concurrent branch update can require another save attempt.

Deleting an attachment in daylight does not remove it from earlier GitHub versions. Edits made directly in GitHub are not imported into daylight. Existing records are not exported without a save action. Only manually entered records can be saved to GitHub.

## Storage and access

Records, files, and connection details are owner-only. The existing **서로의 오늘** task-sharing behavior stays in place.

The existing D1 database keeps editable records and file bytes. Each file can be up to 10 MB. Each record can hold 20 files. Uploads stop when total database attachments reach 200 MB. An R2 subscription is not necessary. An existing R2 binding can still read older files.

`work_github_connections` holds the encrypted token and repository identity. `work_github_versions` holds saved commit links and content hashes. The project screen shows the most recent 500 saved versions. Older versions stay in the database and GitHub.

## Development and deployment

Use Node.js 24 or later. Apply each SQL file in `drizzle/` once, in order. Migration `0009_work_github.sql` adds the GitHub connection and version tables. It does not change existing records.

Set a random `WORK_GITHUB_KEY` secret with at least 32 characters on the Google Worker. Keep it stable. If it changes, reconnect each GitHub project. Do not put the key or a GitHub token in Git. See [deployment instructions](../deploy/README.md#github-record-storage).

The bounded check is `node scripts/check-work-github.mjs`. It uses an in-memory database and a mock GitHub API. It does not change production data. Build with `npm run build` before deployment. Keep the original Sites manifest and database separate.
