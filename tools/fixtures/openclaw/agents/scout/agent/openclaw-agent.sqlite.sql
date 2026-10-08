-- A made-up OpenClaw agent database (agent scout), for tools/test_vault.ts: one session, a reading list.
CREATE TABLE IF NOT EXISTS session_nodes (
  session_key TEXT NOT NULL PRIMARY KEY,
  current_session_id TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL DEFAULT 0,
  legacy_acp_migration_json TEXT,
  entry_valid INTEGER NOT NULL DEFAULT 0 CHECK (entry_valid IN (-1, 0, 1)),
  updated_at INTEGER NOT NULL,
  status TEXT CHECK (status IS NULL OR status IN ('running', 'done', 'failed', 'killed', 'timeout')),
  created_at INTEGER,
  created_via TEXT CHECK (created_via IS NULL OR created_via IN ('operator', 'spawn', 'channel', 'cron', 'talk', 'run', 'plugin', 'internal')),
  created_actor_type TEXT CHECK (created_actor_type IS NULL OR created_actor_type IN ('human', 'agent', 'system')),
  created_actor_id TEXT,
  owner_actor_type TEXT,
  owner_actor_id TEXT,
  owner_assigned_by_type TEXT,
  owner_assigned_by_id TEXT,
  owner_assigned_at INTEGER,
  project_id TEXT,
  parent_session_key TEXT,
  spawned_by TEXT,
  fork_source_session_key TEXT,
  fork_source_session_id TEXT,
  fork_source_entry_id TEXT,
  label TEXT,
  display_name TEXT,
  category TEXT,
  icon TEXT,
  pinned_at INTEGER,
  archived_at INTEGER,
  last_read_at INTEGER,
  last_interaction_at INTEGER,
  last_activity_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS session_windows (
  session_id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  previous_session_id TEXT,
  reason TEXT CHECK (reason IS NULL OR reason IN ('initial', 'reset', 'rollover', 'fork', 'rewind', 'switch', 'recovery', 'compaction')),
  session_scope TEXT NOT NULL DEFAULT 'conversation' CHECK (session_scope IN ('conversation', 'shared-main', 'group', 'channel')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  transcript_updated_at INTEGER DEFAULT NULL,
  transcript_observed_at INTEGER DEFAULT NULL,
  session_entry_provenance INTEGER NOT NULL DEFAULT 0 CHECK (session_entry_provenance IN (0, 1)),
  acp_owned INTEGER NOT NULL DEFAULT 0 CHECK (acp_owned IN (0, 1)),
  plugin_owner_id TEXT,
  hook_external_content_source TEXT CHECK (hook_external_content_source IS NULL OR hook_external_content_source IN ('gmail', 'webhook')),
  started_at INTEGER,
  ended_at INTEGER,
  status TEXT CHECK (status IS NULL OR status IN ('running', 'done', 'failed', 'killed', 'timeout')),
  chat_type TEXT CHECK (chat_type IS NULL OR chat_type IN ('direct', 'group', 'channel')),
  channel TEXT,
  account_id TEXT,
  primary_conversation_id TEXT,
  model_provider TEXT,
  model TEXT,
  agent_harness_id TEXT,
  parent_session_key TEXT,
  spawned_by TEXT,
  display_name TEXT,
  FOREIGN KEY (session_key) REFERENCES session_nodes(session_key) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS transcript_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_json TEXT,
  created_at INTEGER NOT NULL,
  event_zstd BLOB,
  event_utf8_bytes INTEGER CHECK (event_utf8_bytes IS NULL OR event_utf8_bytes >= 0),
  navigation_json TEXT,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES "session_windows"(session_id) ON DELETE CASCADE,
  CHECK (
    (event_json IS NOT NULL AND event_zstd IS NULL)
    OR (
      event_json IS NULL AND event_zstd IS NOT NULL
      AND event_utf8_bytes IS NOT NULL
      AND event_utf8_bytes BETWEEN 1 AND 4194304
      AND length(event_zstd) BETWEEN 1 AND 4194304
      AND navigation_json IS NOT NULL
    )
  ),
  CHECK (
    navigation_json IS NULL OR CASE WHEN json_valid(navigation_json) THEN coalesce(
      octet_length(navigation_json) <= 16384
      AND json_type(navigation_json, '$.version') = 'integer'
      AND json_extract(navigation_json, '$.version') = 1
      AND json_type(navigation_json, '$.report') = 'object'
      AND json_extract(navigation_json, '$.report.kind') IN ('canonical', 'leaf', 'link', 'ignored')
      AND json_type(navigation_json, '$.navigation') = 'object'
      AND json_type(navigation_json, '$.reset') = 'object'
      AND json_type(navigation_json, '$.model') = 'object'
      AND json_type(navigation_json, '$.modelBytes') = 'integer'
      AND json_extract(navigation_json, '$.modelBytes') BETWEEN 0 AND 4194304
      AND json_type(navigation_json, '$.modelWithoutCheckpointBytes') = 'integer'
      AND json_extract(navigation_json, '$.modelWithoutCheckpointBytes') BETWEEN 0 AND 4194304
      AND json_type(navigation_json, '$.withoutCustomDataBytes') = 'integer'
      AND json_extract(navigation_json, '$.withoutCustomDataBytes') BETWEEN 0 AND 4194304,
      0) ELSE 0 END
  )
) STRICT;

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('agent:scout:main', 'f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf', '{"sessionId":"f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf","sessionStartedAt":1789996400000,"updatedAt":1789996410000,"model":"claude-sonnet-5","modelProvider":"anthropic"}', 1789996410000, 'done', 1789996400000, NULL, NULL, 'Reading list', 1789996410000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf', 'agent:scout:main', 'initial', 1789996400000, 1789996410000, 1789996400000, 'done');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf', 1, '{"type":"session","version":4,"id":"f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf","timestamp":"2026-09-21T13:13:20.000Z","cwd":"/Users/alice/notes"}', 1789996400000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf', 2, '{"type":"message","id":"r1","parentId":null,"timestamp":"2026-09-21T13:13:21.000Z","message":{"role":"user","content":[{"type":"text","text":"What should I read next?"}],"timestamp":1789996401000}}', 1789996401000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('f6a5b8c7-a0bd-4bcf-d2e3-5e6f7a8b9caf', 3, '{"type":"message","id":"r2","parentId":"r1","timestamp":"2026-09-21T13:13:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Start with the essay on calm technology."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-5","usage":{"input":3000,"output":1000,"cacheRead":0,"cacheWrite":0,"totalTokens":4000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.05}},"stopReason":"stop","timestamp":1789996410000}}', 1789996410000);
