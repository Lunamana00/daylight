ALTER TABLE daylight_google_calendar_connections ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daylight_google_calendar_flows ADD COLUMN request_edit INTEGER NOT NULL DEFAULT 0;
