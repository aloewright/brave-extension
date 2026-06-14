-- 0006_scrapes.sql - browser extension scraping jobs and runs.
--
-- scrape_runs stores both ad hoc extension-provided page captures and
-- Worker-fetched URL scrapes. scrape_jobs stores reusable manual, interval,
-- or cron schedules; Worker scheduled events run due enabled jobs.

CREATE TABLE IF NOT EXISTS scrape_runs (
  id             TEXT PRIMARY KEY,
  job_id         TEXT,
  source         TEXT NOT NULL DEFAULT 'extension', -- 'extension'|'server'|'manual'|'cron'
  url            TEXT NOT NULL,
  final_url      TEXT,
  title          TEXT NOT NULL DEFAULT '',
  text           TEXT NOT NULL DEFAULT '',
  html           TEXT NOT NULL DEFAULT '',
  links          TEXT NOT NULL DEFAULT '[]',
  images         TEXT NOT NULL DEFAULT '[]',
  meta           TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'ready',  -- 'ready'|'failed'
  status_message TEXT,
  content_type   TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_created ON scrape_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_url ON scrape_runs(url);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_job ON scrape_runs(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id               TEXT PRIMARY KEY,
  url              TEXT NOT NULL,
  title            TEXT NOT NULL DEFAULT '',
  enabled          INTEGER NOT NULL DEFAULT 1,
  schedule_type    TEXT NOT NULL DEFAULT 'manual', -- 'manual'|'interval'|'cron'
  interval_minutes INTEGER,
  cron_expr        TEXT,
  last_run_id      TEXT,
  last_run_at      INTEGER,
  next_run_at      INTEGER,
  last_status      TEXT,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_next_run ON scrape_jobs(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_created ON scrape_jobs(created_at DESC);
