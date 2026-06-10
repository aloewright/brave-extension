CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'session',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source, updated_at DESC);
