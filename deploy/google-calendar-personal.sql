CREATE TABLE __personal_calendar_sources (
  owner_id TEXT NOT NULL REFERENCES members(id),
  calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, calendar_id)
);
INSERT INTO __personal_calendar_sources SELECT owner_id,calendar_id,name,synced_at FROM calendar_sources;

CREATE TABLE __personal_milestones (
  owner_id TEXT NOT NULL REFERENCES members(id),
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  url TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, calendar_id, event_id)
);
INSERT INTO __personal_milestones SELECT owner_id,calendar_id,event_id,title,date,url,synced_at FROM milestones;

CREATE TABLE __personal_calendar_connections (
  calendar_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  locked_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  last_error TEXT,
  PRIMARY KEY (owner_id, calendar_id),
  FOREIGN KEY (owner_id, calendar_id) REFERENCES __personal_calendar_sources(owner_id, calendar_id)
);
INSERT INTO __personal_calendar_connections SELECT calendar_id,owner_id,google_sub,email,refresh_token,enabled,locked_until,lease_id,last_error FROM daylight_google_calendar_connections;

DROP TABLE daylight_google_calendar_connections;
DROP TABLE milestones;
DROP TABLE calendar_sources;
ALTER TABLE __personal_calendar_sources RENAME TO calendar_sources;
ALTER TABLE __personal_milestones RENAME TO milestones;
ALTER TABLE __personal_calendar_connections RENAME TO daylight_google_calendar_connections;
CREATE INDEX milestones_date ON milestones(date);
