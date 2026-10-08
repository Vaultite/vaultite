-- A made-up OpenClaw agent database (main; schema 24, the tables the plugin reads) for tools/test_vault.ts, which moves
-- its times so the newest is an hour ago and zstd-compresses events of 512 bytes and more. Sessions: an upload fix (running,
-- with a subagent, a rewound branch, runtime context), notes in a sibling worktree and a fork of them, a morning brief.
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

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('agent:main:main', 'a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', '{"sessionId":"a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a","sessionStartedAt":1790000000000,"updatedAt":1790000215000,"model":"claude-sonnet-5","modelProvider":"anthropic"}', 1790000215000, 'running', 1790000000000, NULL, NULL, 'Upload retry fix', 1790000215000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 'agent:main:main', 'initial', 1790000000000, 1790000215000, 1790000000000, 'running');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 1, '{"type":"session","version":4,"id":"a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a","timestamp":"2026-09-21T14:13:20.000Z","cwd":"/Users/alice/lighthouse"}', 1790000000000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 2, '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-09-21T14:13:21.000Z","message":{"role":"user","content":[{"type":"text","text":"Fix the flaky upload test"}],"timestamp":1790000001000}}', 1790000001000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 3, '{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-09-21T14:13:21.500Z","message":{"role":"user","content":[{"type":"text","text":"Current time: Tuesday morning."}],"runtimeContext":{"retained":true},"timestamp":1790000001500}}', 1790000001500);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 4, '{"type":"message","id":"m3","parentId":"m2","timestamp":"2026-09-21T14:13:40.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"The retry has no wait."},{"type":"text","text":"Looking at the test first."},{"type":"toolCall","id":"call_1","name":"exec","arguments":{"command":"npm test -- upload"}}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-5","usage":{"input":1200,"output":300,"cacheRead":8000,"cacheWrite":500,"totalTokens":10000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.05}},"stopReason":"stop","timestamp":1790000020000}}', 1790000020000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 5, '{"type":"message","id":"m4","parentId":"m3","timestamp":"2026-09-21T14:13:50.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"exec","isError":true,"content":[{"type":"text","text":"1 failing: upload retries\n\n- Step 1: checked the upload queue, the retry timer and the backoff settings.\n- Step 2: checked the upload queue, the retry timer and the backoff settings.\n- Step 3: checked the upload queue, the retry timer and the backoff settings.\n- Step 4: checked the upload queue, the retry timer and the backoff settings.\n- Step 5: checked the upload queue, the retry timer and the backoff settings.\n- Step 6: checked the upload queue, the retry timer and the backoff settings.\n- Step 7: checked the upload queue, the retry timer and the backoff settings.\n- Step 8: checked the upload queue, the retry timer and the backoff settings."}],"timestamp":1790000030000}}', 1790000030000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 6, '{"type":"message","id":"m5","parentId":"m4","timestamp":"2026-09-21T14:14:50.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Fixed: the retry **waits** now.\n\n- Step 1: checked the upload queue, the retry timer and the backoff settings.\n- Step 2: checked the upload queue, the retry timer and the backoff settings.\n- Step 3: checked the upload queue, the retry timer and the backoff settings.\n- Step 4: checked the upload queue, the retry timer and the backoff settings.\n- Step 5: checked the upload queue, the retry timer and the backoff settings.\n- Step 6: checked the upload queue, the retry timer and the backoff settings.\n- Step 7: checked the upload queue, the retry timer and the backoff settings.\n- Step 8: checked the upload queue, the retry timer and the backoff settings."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-5","usage":{"input":800,"output":1200,"cacheRead":9000,"cacheWrite":0,"totalTokens":11000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.04}},"stopReason":"stop","timestamp":1790000090000}}', 1790000090000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 7, '{"type":"message","id":"x1","parentId":"m5","timestamp":"2026-09-21T14:15:20.000Z","message":{"role":"user","content":[{"type":"text","text":"Also bump the version"}],"timestamp":1790000120000}}', 1790000120000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 8, '{"type":"leaf","id":"l1","parentId":"x1","targetId":"m5"}', 1790000150000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 9, '{"type":"message","id":"m6","parentId":"l1","timestamp":"2026-09-21T14:16:40.000Z","message":{"role":"user","content":[{"type":"text","text":"Thanks, that works"}],"timestamp":1790000200000}}', 1790000200000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a', 10, '{"type":"message","id":"m7","parentId":"m6","timestamp":"2026-09-21T14:16:55.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Glad it does."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-5","usage":{"input":900,"output":100,"cacheRead":0,"cacheWrite":0,"totalTokens":1000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.01}},"stopReason":"stop","timestamp":1790000215000}}', 1790000215000);

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('agent:main:subagent:7c1e', 'd4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d', '{"sessionId":"d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d","sessionStartedAt":1790000040000,"updatedAt":1790000050000,"model":"claude-haiku-4-5","modelProvider":"anthropic"}', 1790000050000, 'done', 1790000040000, 'agent:main:main', NULL, NULL, 1790000050000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d', 'agent:main:subagent:7c1e', 'initial', 1790000040000, 1790000050000, 1790000040000, 'done');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d', 1, '{"type":"session","version":4,"id":"d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d","timestamp":"2026-09-21T14:14:00.000Z","cwd":"/Users/alice/lighthouse"}', 1790000040000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d', 2, '{"type":"message","id":"s1","parentId":null,"timestamp":"2026-09-21T14:14:01.000Z","message":{"role":"user","content":[{"type":"text","text":"Find the retry code"}],"timestamp":1790000041000}}', 1790000041000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('d4e3f6a5-8e9b-4fad-b0c1-3c4d5e6f7a8d', 3, '{"type":"message","id":"s2","parentId":"s1","timestamp":"2026-09-21T14:14:10.000Z","message":{"role":"assistant","content":[{"type":"text","text":"It is in src/upload.ts."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-haiku-4-5","usage":{"input":2500,"output":500,"cacheRead":0,"cacheWrite":0,"totalTokens":3000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.02}},"stopReason":"stop","timestamp":1790000050000}}', 1790000050000);

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('agent:main:lighthouse-notes', 'b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b', '{"sessionId":"b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b","sessionStartedAt":1789827200000,"updatedAt":1789827220000,"model":"gpt-5.4-mini","modelProvider":"openai"}', 1789827220000, 'done', 1789827200000, NULL, 'Lighthouse notes', NULL, 1789827220000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b', 'agent:main:lighthouse-notes', 'initial', 1789827200000, 1789827220000, 1789827200000, 'done');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b', 1, '{"type":"session","version":4,"id":"b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b","timestamp":"2026-09-19T14:13:20.000Z","cwd":"/Users/alice/lighthouse-ui"}', 1789827200000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b', 2, '{"type":"message","id":"n1","parentId":null,"timestamp":"2026-09-19T14:13:30.000Z","message":{"role":"user","content":"Summarize the open issues","timestamp":1789827210000}}', 1789827210000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b', 3, '{"type":"message","id":"n2","parentId":"n1","timestamp":"2026-09-19T14:13:40.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Three are open: uploads, dark mode, the header."}],"api":"anthropic-messages","provider":"openai","model":"gpt-5.4-mini","usage":{"input":1500,"output":500,"cacheRead":0,"cacheWrite":0,"totalTokens":2000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.03}},"stopReason":"stop","timestamp":1789827220000}}', 1789827220000);

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('agent:main:lighthouse-notes:fork', 'e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e', '{"sessionId":"e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e","sessionStartedAt":1789828000000,"updatedAt":1789827220000,"model":"gpt-5.4-mini","modelProvider":"openai"}', 1789827220000, 'done', 1789828000000, NULL, NULL, NULL, 1789827220000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e', 'agent:main:lighthouse-notes:fork', 'fork', 1789828000000, 1789827220000, 1789828000000, 'done');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e', 1, '{"type":"session","version":4,"id":"e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e","timestamp":"2026-09-19T14:26:40.000Z","cwd":"/Users/alice/lighthouse-ui","parentSession":"b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b"}', 1789828000000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e', 2, '{"type":"message","id":"n1","parentId":null,"timestamp":"2026-09-19T14:13:30.000Z","message":{"role":"user","content":"Summarize the open issues","timestamp":1789827210000}}', 1789827210000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('e5f4a7b6-9fac-4abe-c1d2-4d5e6f7a8b9e', 3, '{"type":"message","id":"n2","parentId":"n1","timestamp":"2026-09-19T14:13:40.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Three are open: uploads, dark mode, the header."}],"api":"anthropic-messages","provider":"openai","model":"gpt-5.4-mini","usage":{"input":1500,"output":500,"cacheRead":0,"cacheWrite":0,"totalTokens":2000,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.03}},"stopReason":"stop","timestamp":1789827220000}}', 1789827220000);

INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at, status, created_at, parent_session_key, label, display_name, last_activity_at) VALUES ('cron:morning-brief', 'c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c', '{"sessionId":"c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c","sessionStartedAt":1789992800000,"updatedAt":1789992810000,"model":"gpt-5.4-mini","modelProvider":"openai"}', 1789992810000, 'done', 1789992800000, NULL, NULL, NULL, 1789992810000);
INSERT INTO session_windows (session_id, session_key, reason, created_at, updated_at, started_at, status) VALUES ('c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c', 'cron:morning-brief', 'initial', 1789992800000, 1789992810000, 1789992800000, 'done');
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c', 1, '{"type":"session","version":4,"id":"c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c","timestamp":"2026-09-21T12:13:20.000Z","cwd":"/Users/alice/.openclaw/workspace"}', 1789992800000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c', 2, '{"type":"message","id":"b1","parentId":null,"timestamp":"2026-09-21T12:13:21.000Z","message":{"role":"user","content":[{"type":"text","text":"Write my morning brief"}],"timestamp":1789992801000}}', 1789992801000);
INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES ('c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c', 3, '{"type":"message","id":"b2","parentId":"b1","timestamp":"2026-09-21T12:13:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Two meetings, one deadline: the Lighthouse beta."}],"api":"anthropic-messages","provider":"openai","model":"gpt-5.4-mini","usage":{"input":800,"output":200,"cacheRead":0,"cacheWrite":0,"totalTokens":1000},"stopReason":"stop","timestamp":1789992810000}}', 1789992810000);
