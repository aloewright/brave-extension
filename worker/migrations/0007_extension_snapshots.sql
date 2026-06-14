-- 0007_extension_snapshots.sql - installed extension and manager-state snapshots.
--
-- The browser owns the actual installed extensions; this table gives the
-- Browser Extension Worker a durable copy of what the extension manager saw,
-- plus the app-owned profiles/groups/settings that would otherwise only live
-- in chrome.storage.local.

CREATE TABLE IF NOT EXISTS extension_snapshots (
  extension_id TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0,
  type         TEXT NOT NULL DEFAULT 'extension',
  version      TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  install_type TEXT,
  homepage_url TEXT,
  may_disable  INTEGER NOT NULL DEFAULT 0,
  icons        TEXT NOT NULL DEFAULT '[]',
  synced_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extension_snapshots_synced ON extension_snapshots(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_extension_snapshots_enabled ON extension_snapshots(enabled);

CREATE TABLE IF NOT EXISTS extension_config_snapshots (
  id          TEXT PRIMARY KEY CHECK (id = 'current'),
  profiles    TEXT NOT NULL DEFAULT '[]',
  groups      TEXT NOT NULL DEFAULT '[]',
  settings    TEXT NOT NULL DEFAULT '{}',
  last_used   TEXT NOT NULL DEFAULT '{}',
  pulled_at   TEXT,
  synced_at   INTEGER NOT NULL
);
