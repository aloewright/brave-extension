-- Agent app core tables. Lives in the shared "sidebar" D1.
-- Prefixed agent_ to avoid collision with sidebar-api tables.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id          TEXT PRIMARY KEY,        -- ulid
  user_id     TEXT NOT NULL,           -- Access identity (email or service-token id)
  title       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user
  ON agent_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id          TEXT PRIMARY KEY,        -- ulid
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,           -- 'user' | 'assistant' | 'system'
  content     TEXT NOT NULL,
  model       TEXT,                    -- model/route used (null for user msgs)
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session
  ON agent_messages(session_id, created_at ASC);

-- Mirror/index of Hindsight memories (populated in a later plan).
CREATE TABLE IF NOT EXISTS agent_memories (
  id          TEXT PRIMARY KEY,        -- ulid
  user_id     TEXT NOT NULL,
  session_id  TEXT,                    -- nullable: cross-session memories
  kind        TEXT NOT NULL,           -- 'fact' | 'reflection' | 'mental_model'
  content     TEXT NOT NULL,
  hindsight_ref TEXT,                  -- external Hindsight id, if any
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_user
  ON agent_memories(user_id, created_at DESC);
