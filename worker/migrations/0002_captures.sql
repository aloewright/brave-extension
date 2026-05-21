-- 0002_captures.sql — ALO-468 page captures (R2 + Vectorize).
--
-- A capture is a screenshot or full-page PDF the sidebar uploads when
-- the user has chosen "cloud" as their capture save location. R2 stores
-- the bytes, this table stores metadata, and Vectorize indexes the
-- searchable text we extract (OCR for screenshots, text-layer / OCR
-- for PDFs).

CREATE TABLE IF NOT EXISTS captures (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,            -- 'screenshot' | 'pdf'
  filename       TEXT NOT NULL,
  source_url     TEXT,
  source_title   TEXT,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  r2_key         TEXT NOT NULL,
  extracted_text TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'ready'|'failed'
  status_message TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_kind    ON captures(kind);
CREATE INDEX IF NOT EXISTS idx_captures_status  ON captures(status);
