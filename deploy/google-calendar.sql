CREATE TABLE IF NOT EXISTS daylight_google_calendar_flows (
  state TEXT PRIMARY KEY REFERENCES daylight_google_flows(state) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  calendar_id TEXT
);

