DROP INDEX IF EXISTS daylight_one_team_calendar;

CREATE TABLE IF NOT EXISTS daylight_google_calendar_connections (
  calendar_id TEXT PRIMARY KEY REFERENCES calendar_sources(calendar_id),
  owner_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  locked_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  last_error TEXT
);
