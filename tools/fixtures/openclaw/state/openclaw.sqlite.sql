-- A made-up OpenClaw shared database (the cron tables), for tools/test_vault.ts; its times move with the agents'.
CREATE TABLE IF NOT EXISTS cron_jobs (
  store_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  declaration_key TEXT,
  owner_agent_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL,
  agent_id TEXT,
  payload_kind TEXT NOT NULL,
  job_json TEXT NOT NULL,
  grant_definition_revision TEXT,
  grant_definition_generation INTEGER,
  grant_definition_updated_at INTEGER,
  state_json TEXT NOT NULL DEFAULT '{}',
  runtime_updated_at_ms INTEGER,
  schedule_identity TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_key, job_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_store_order
  ON cron_jobs(store_key, sort_order ASC, updated_at ASC, job_id);

-- One owner-native receipt is also the durable execution fence. Receipts
-- survive job deletion so operators can distinguish a run from log inference.
CREATE TABLE IF NOT EXISTS cron_run_receipts (
  receipt_id TEXT PRIMARY KEY,
  store_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  config_revision TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  request_run_id TEXT,
  delivery_attempt_state TEXT NOT NULL DEFAULT 'unknown' CHECK (delivery_attempt_state IN ('unknown', 'not-started', 'started')),
  status TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_start_time INTEGER,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  error_text TEXT,
  CHECK (status IN ('running', 'ok', 'error', 'skipped', 'interrupted', 'superseded')),
  CHECK (
    (status = 'running' AND finished_at_ms IS NULL)
    OR
    (status != 'running' AND finished_at_ms IS NOT NULL)
  )
) STRICT;

INSERT INTO cron_jobs (store_key, job_id, owner_agent_id, name, enabled, agent_id, payload_kind, job_json, state_json, sort_order, updated_at) VALUES ('default', 'morning-brief', 'main', 'Morning brief', 1, 'main', 'agentTurn', '{"id":"morning-brief","name":"Morning brief","enabled":true,"schedule":{"kind":"cron","expr":"0 7 * * *","tz":"America/Los_Angeles"},"payload":{"kind":"agentTurn","message":"Write my morning brief"},"sessionTarget":"isolated"}', '{"nextRunAtMs":1790079200000,"lastRunAtMs":1789992800000,"lastRunStatus":"ok"}', 0, 1789913600000);
INSERT INTO cron_jobs (store_key, job_id, owner_agent_id, name, enabled, agent_id, payload_kind, job_json, state_json, sort_order, updated_at) VALUES ('default', 'weekly-review', 'main', 'Weekly review', 0, 'main', 'systemEvent', '{"id":"weekly-review","name":"Weekly review","enabled":false,"schedule":{"kind":"every","everyMs":604800000},"payload":{"kind":"systemEvent","text":"Time for the weekly review"},"sessionTarget":"main"}', '{"lastRunAtMs":1789395200000,"lastRunStatus":"error","lastError":"model timed out"}', 1, 1789913600000);
INSERT INTO cron_jobs (store_key, job_id, owner_agent_id, name, enabled, agent_id, payload_kind, job_json, state_json, sort_order, updated_at) VALUES ('default', 'scout-digest', 'scout', 'Reading digest', 1, 'scout', 'agentTurn', '{"id":"scout-digest","name":"Reading digest","enabled":true,"schedule":{"kind":"at","at":"2026-12-01T09:00:00Z"},"payload":{"kind":"agentTurn","message":"Send the reading digest"},"sessionTarget":"isolated"}', '{"nextRunAtMs":1795000000000}', 2, 1789913600000);
INSERT INTO cron_run_receipts (receipt_id, store_key, job_id, config_revision, agent_id, status, owner_pid, started_at_ms, finished_at_ms) VALUES ('r-1', 'default', 'morning-brief', '1', 'main', 'ok', 4242, 1789992800000, 1789992812000);
