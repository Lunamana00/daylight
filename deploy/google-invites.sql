CREATE TABLE IF NOT EXISTS daylight_google_invites (
  email TEXT PRIMARY KEY,
  subject TEXT,
  member_id TEXT UNIQUE REFERENCES members(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);
