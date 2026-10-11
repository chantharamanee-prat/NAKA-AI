-- When each background loop last ran (src/admin/server-status.ts): the cron writes 'cron' every minute, so the back
-- office's สถานะเซิร์ฟเวอร์ page can tell a stopped worker from a quiet one. One row per name, overwritten.
-- Runs as account_app with search_path = account; never name the schema here.
CREATE TABLE runtime_heartbeats (
  name text PRIMARY KEY CHECK (name ~ '^[a-z_]{1,40}$'),
  at bigint NOT NULL,
  detail text NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
);
