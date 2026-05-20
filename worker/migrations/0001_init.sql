-- 0001_init.sql — initial schema for all five resource types.
-- Phase 1 only exercises conversations + links; the other tables exist so
-- Phase 2/3 don't need a follow-up structural migration.

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  backend       TEXT NOT NULL,
  title         TEXT NOT NULL,
  content_text  TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_backend ON conversations(backend, updated_at DESC);

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  favicon     TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_url ON links(url);
CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  parent_id   TEXT,
  path        TEXT NOT NULL DEFAULT '[]',
  category    TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  date_added  INTEGER,
  position    INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  synced_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_synced   ON bookmarks(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);

CREATE TABLE IF NOT EXISTS recordings (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  source         TEXT NOT NULL,
  origin_url     TEXT,
  r2_key         TEXT NOT NULL,
  transcript     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status  ON recordings(status);

CREATE TABLE IF NOT EXISTS pdfs (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  title          TEXT,
  source_url     TEXT,
  size_bytes     INTEGER NOT NULL,
  page_count     INTEGER,
  r2_key         TEXT NOT NULL,
  text_content   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdfs_created ON pdfs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdfs_status  ON pdfs(status);
