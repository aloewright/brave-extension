-- 0004_highlights.sql - selected text saved from the dev extension.
--
-- Highlights are short text selections captured from browser pages. The
-- extension stores them locally for review cards and mirrors them here so the
-- Worker can serve a searchable, editable txt.fly.pm archive.

CREATE TABLE IF NOT EXISTS highlights (
  id             TEXT PRIMARY KEY,
  text           TEXT NOT NULL,
  note           TEXT,
  tags           TEXT NOT NULL DEFAULT '[]',
  source_url     TEXT,
  source_title   TEXT,
  source_host    TEXT,
  source_favicon TEXT,
  context_before TEXT,
  context_after  TEXT,
  source         TEXT NOT NULL DEFAULT 'extension',
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_highlights_created ON highlights(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_highlights_host    ON highlights(source_host);
