CREATE TABLE IF NOT EXISTS daylight_google_flows (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  mac_challenge TEXT,
  mac_state TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daylight_google_mac_codes (
  code_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daylight_google_sessions (
  session_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('web', 'mac')),
  expires_at INTEGER NOT NULL
);
