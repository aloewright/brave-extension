-- 0008_newtab_state.sql - durable new tab customization snapshot.
--
-- Stores extension-owned new tab state: quick links, custom apps, hidden
-- built-ins, app order, and icon overrides. These values live in
-- chrome.storage.local in the extension and are mirrored here for durability.

CREATE TABLE IF NOT EXISTS newtab_state_snapshots (
  id                 TEXT PRIMARY KEY CHECK (id = 'current'),
  quick_links        TEXT NOT NULL DEFAULT '[]',
  custom_apps        TEXT NOT NULL DEFAULT '[]',
  hidden_apps        TEXT NOT NULL DEFAULT '[]',
  app_order          TEXT NOT NULL DEFAULT '[]',
  app_icon_overrides TEXT NOT NULL DEFAULT '{}',
  synced_at          INTEGER NOT NULL
);
