-- 0003_agent_sessions.sql — page-local browser agent sessions.
--
-- Stores compact agent state and history for the first-party browser bubble.
-- Page screenshots and raw DOM are intentionally not stored here; callers pass
-- the capped observation contract from the extension.

CREATE TABLE IF NOT EXISTS browser_agent_sessions (
  id              TEXT PRIMARY KEY,
  objective       TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'planning',
  next_step       TEXT NOT NULL DEFAULT '',
  compact_summary TEXT NOT NULL DEFAULT '',
  token_estimate  INTEGER NOT NULL DEFAULT 0,
  memory_refs     TEXT NOT NULL DEFAULT '[]',
  last_observation TEXT,
  pending_consent TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_agent_sessions_updated ON browser_agent_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS browser_agent_messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  role            TEXT NOT NULL,
  content_text    TEXT NOT NULL,
  observation     TEXT,
  token_estimate  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_agent_messages_session ON browser_agent_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS browser_agent_memories (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_agent_memories_session ON browser_agent_memories(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_agent_memories_key ON browser_agent_memories(key);
