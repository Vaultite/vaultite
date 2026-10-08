-- A made-up OpenCode database (1.18, the tables the plugin reads), for tools/test_vault.ts. The test shifts every
-- 13-digit time so the newest is an hour ago. Sessions: an upload fix in lighthouse (with a subagent's session and a
-- fork that copied its first reply), and an untitled one in a sibling worktree, lighthouse-ui, with a reply still streaming.
CREATE TABLE `project` (
  `id` text PRIMARY KEY,
  `worktree` text NOT NULL,
  `vcs` text,
  `name` text,
  `icon_url` text,
  `icon_url_override` text,
  `icon_color` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_initialized` integer,
  `sandboxes` text NOT NULL,
  `commands` text
);
CREATE TABLE `message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `part` (
  `id` text PRIMARY KEY,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_part_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session` (
  `id` text PRIMARY KEY,
  `project_id` text NOT NULL,
  `workspace_id` text,
  `parent_id` text,
  `slug` text NOT NULL,
  `directory` text NOT NULL,
  `path` text,
  `title` text NOT NULL,
  `version` text NOT NULL,
  `share_url` text,
  `summary_additions` integer,
  `summary_deletions` integer,
  `summary_files` integer,
  `summary_diffs` text,
  `metadata` text,
  `cost` real DEFAULT 0 NOT NULL,
  `tokens_input` integer DEFAULT 0 NOT NULL,
  `tokens_output` integer DEFAULT 0 NOT NULL,
  `tokens_reasoning` integer DEFAULT 0 NOT NULL,
  `tokens_cache_read` integer DEFAULT 0 NOT NULL,
  `tokens_cache_write` integer DEFAULT 0 NOT NULL,
  `revert` text,
  `permission` text,
  `agent` text,
  `model` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_compacting` integer,
  `time_archived` integer,
  CONSTRAINT `fk_session_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
CREATE INDEX `message_session_time_created_id_idx` ON `message` (`session_id`,`time_created`,`id`);
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`,`id`);
CREATE INDEX `part_session_idx` ON `part` (`session_id`);
CREATE INDEX `session_project_idx` ON `session` (`project_id`);
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);

INSERT INTO project VALUES ('prj_lighthouse', '/Users/sam/lighthouse', 'git', NULL, NULL, NULL, NULL, 1790586000000, 1790586000000, NULL, '[]', NULL);
INSERT INTO session (id, project_id, parent_id, slug, directory, path, title, version, time_created, time_updated) VALUES ('ses_fixtureA001', 'prj_lighthouse', NULL, 'fixtureA001', '/Users/sam/lighthouse', '', 'Upload retry fix', '1.18.33', 1790586000000, 1790586200000);
INSERT INTO session (id, project_id, parent_id, slug, directory, path, title, version, time_created, time_updated) VALUES ('ses_fixtureA002', 'prj_lighthouse', 'ses_fixtureA001', 'fixtureA002', '/Users/sam/lighthouse', '', 'Child session - 2026-09-28T09:01:00.000Z', '1.18.33', 1790586060000, 1790586090000);
INSERT INTO session (id, project_id, parent_id, slug, directory, path, title, version, time_created, time_updated) VALUES ('ses_fixtureA003', 'prj_lighthouse', NULL, 'fixtureA003', '/Users/sam/lighthouse', '', 'Upload retry fix (fork #1)', '1.18.33', 1790586300000, 1790586400000);
INSERT INTO session (id, project_id, parent_id, slug, directory, path, title, version, time_created, time_updated) VALUES ('ses_fixtureB001', 'prj_lighthouse', NULL, 'fixtureB001', '/Users/sam/lighthouse-ui', '', 'New session - 2026-09-28T10:00:00.000Z', '1.18.33', 1790589600000, 1790589700000);
INSERT INTO message VALUES ('msg_fixtureA0001', 'ses_fixtureA001', 1790586000000, 1790586000000, '{"role":"user","time":{"created":1790586000000},"agent":"build","model":{"providerID":"anthropic","modelID":"claude-sonnet-5"}}');
INSERT INTO part VALUES ('prt_fixture0001', 'msg_fixtureA0001', 'ses_fixtureA001', 1790586000000, 1790586000000, '{"type":"text","text":"Fix the flaky upload test"}');
INSERT INTO part VALUES ('prt_fixture0002', 'msg_fixtureA0001', 'ses_fixtureA001', 1790586000000, 1790586000000, '{"type":"text","text":"Called the Read tool on AGENTS.md","synthetic":true}');
INSERT INTO message VALUES ('msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse","root":"/Users/sam/lighthouse"},"cost":0.05,"tokens":{"total":6550,"input":1000,"output":200,"reasoning":50,"cache":{"read":5000,"write":300}},"modelID":"claude-sonnet-5","providerID":"anthropic","time":{"created":1790586001000,"completed":1790586061000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0003', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"step-start"}');
INSERT INTO part VALUES ('prt_fixture0004', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"reasoning","text":"Tests first.","time":{"start":1790586002000,"end":1790586003000}}');
INSERT INTO part VALUES ('prt_fixture0005', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"text","text":"Running the tests first.","time":{"start":1790586003000,"end":1790586004000}}');
INSERT INTO part VALUES ('prt_fixture0006', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"tool","tool":"bash","callID":"call_1","state":{"status":"error","input":{"command":"npm test -- upload","description":"Run the upload tests"},"error":"1 failing: upload retries","time":{"start":1790586005000,"end":1790586020000}}}');
INSERT INTO part VALUES ('prt_fixture0007', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"tool","tool":"task","callID":"call_2","state":{"status":"completed","input":{"description":"Find the retry code","prompt":"Where are retries?","subagent_type":"explore"},"output":"src/upload.ts","title":"","metadata":{},"time":{"start":1790586021000,"end":1790586060000}}}');
INSERT INTO part VALUES ('prt_fixture0008', 'msg_fixtureA0002', 'ses_fixtureA001', 1790586001000, 1790586001000, '{"type":"step-finish","reason":"tool-calls","tokens":{},"cost":0.05}');
INSERT INTO message VALUES ('msg_fixtureA0003', 'ses_fixtureA001', 1790586062000, 1790586062000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse","root":"/Users/sam/lighthouse"},"cost":0.03,"tokens":{"total":6600,"input":500,"output":100,"reasoning":0,"cache":{"read":6000,"write":0}},"modelID":"claude-sonnet-5","providerID":"anthropic","time":{"created":1790586062000,"completed":1790586122000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0009', 'msg_fixtureA0003', 'ses_fixtureA001', 1790586062000, 1790586062000, '{"type":"tool","tool":"read","callID":"call_3","state":{"status":"completed","input":{"filePath":"/Users/sam/lighthouse/test/upload.test.ts"},"output":"it(''retries'', ...)","title":"","metadata":{},"time":{"start":1790586063000,"end":1790586064000}}}');
INSERT INTO part VALUES ('prt_fixture0010', 'msg_fixtureA0003', 'ses_fixtureA001', 1790586062000, 1790586062000, '{"type":"text","text":"Fixed: the retry **waits** now.","time":{"start":1790586100000,"end":1790586120000}}');
INSERT INTO message VALUES ('msg_fixtureA0101', 'ses_fixtureA002', 1790586060000, 1790586060000, '{"role":"user","time":{"created":1790586060000},"agent":"explore","model":{"providerID":"anthropic","modelID":"claude-haiku-4-5"}}');
INSERT INTO part VALUES ('prt_fixture0011', 'msg_fixtureA0101', 'ses_fixtureA002', 1790586060000, 1790586060000, '{"type":"text","text":"Where are retries?"}');
INSERT INTO message VALUES ('msg_fixtureA0102', 'ses_fixtureA002', 1790586061000, 1790586061000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse","root":"/Users/sam/lighthouse"},"cost":0.02,"tokens":{"total":850,"input":800,"output":50,"reasoning":0,"cache":{"read":0,"write":0}},"modelID":"claude-haiku-4-5","providerID":"anthropic","time":{"created":1790586061000,"completed":1790586090000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0012', 'msg_fixtureA0102', 'ses_fixtureA002', 1790586061000, 1790586061000, '{"type":"text","text":"src/upload.ts"}');
INSERT INTO message VALUES ('msg_fixtureA0201', 'ses_fixtureA003', 1790586300000, 1790586300000, '{"role":"user","time":{"created":1790586000000},"agent":"build","model":{"providerID":"anthropic","modelID":"claude-sonnet-5"}}');
INSERT INTO part VALUES ('prt_fixture0013', 'msg_fixtureA0201', 'ses_fixtureA003', 1790586300000, 1790586300000, '{"type":"text","text":"Fix the flaky upload test"}');
INSERT INTO message VALUES ('msg_fixtureA0202', 'ses_fixtureA003', 1790586300000, 1790586300000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse","root":"/Users/sam/lighthouse"},"cost":0.05,"tokens":{"total":6550,"input":1000,"output":200,"reasoning":50,"cache":{"read":5000,"write":300}},"modelID":"claude-sonnet-5","providerID":"anthropic","time":{"created":1790586001000,"completed":1790586061000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0014', 'msg_fixtureA0202', 'ses_fixtureA003', 1790586300000, 1790586300000, '{"type":"text","text":"Running the tests first."}');
INSERT INTO message VALUES ('msg_fixtureA0203', 'ses_fixtureA003', 1790586310000, 1790586310000, '{"role":"user","time":{"created":1790586310000},"agent":"build","model":{"providerID":"opencode","modelID":"big-pickle"}}');
INSERT INTO part VALUES ('prt_fixture0015', 'msg_fixtureA0203', 'ses_fixtureA003', 1790586310000, 1790586310000, '{"type":"text","text":"Write it up for the changelog"}');
INSERT INTO message VALUES ('msg_fixtureA0204', 'ses_fixtureA003', 1790586311000, 1790586311000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse","root":"/Users/sam/lighthouse"},"cost":0,"tokens":{"total":800,"input":700,"output":100,"reasoning":0,"cache":{"read":0,"write":0}},"modelID":"big-pickle","providerID":"opencode","time":{"created":1790586311000,"completed":1790586341000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0016', 'msg_fixtureA0204', 'ses_fixtureA003', 1790586311000, 1790586311000, '{"type":"text","text":"Uploads retry with a backoff."}');
INSERT INTO message VALUES ('msg_fixtureB0001', 'ses_fixtureB001', 1790589600000, 1790589600000, '{"role":"user","time":{"created":1790589600000},"agent":"build","model":{"providerID":"openai","modelID":"gpt-5.4"}}');
INSERT INTO part VALUES ('prt_fixture0017', 'msg_fixtureB0001', 'ses_fixtureB001', 1790589600000, 1790589600000, '{"type":"text","text":"Make the header sticky"}');
INSERT INTO message VALUES ('msg_fixtureB0002', 'ses_fixtureB001', 1790589601000, 1790589601000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse-ui","root":"/Users/sam/lighthouse-ui"},"cost":0.04,"tokens":{"total":2300,"input":2000,"output":300,"reasoning":0,"cache":{"read":0,"write":0}},"modelID":"gpt-5.4","providerID":"openai","time":{"created":1790589601000,"completed":1790589661000},"finish":"stop"}');
INSERT INTO part VALUES ('prt_fixture0018', 'msg_fixtureB0002', 'ses_fixtureB001', 1790589601000, 1790589601000, '{"type":"text","text":"Done: `position: sticky`."}');
INSERT INTO message VALUES ('msg_fixtureB0003', 'ses_fixtureB001', 1790589700000, 1790589700000, '{"role":"user","time":{"created":1790589700000},"agent":"build","model":{"providerID":"openai","modelID":"gpt-5.4"}}');
INSERT INTO part VALUES ('prt_fixture0019', 'msg_fixtureB0003', 'ses_fixtureB001', 1790589700000, 1790589700000, '{"type":"text","text":"And the footer"}');
INSERT INTO message VALUES ('msg_fixtureB0004', 'ses_fixtureB001', 1790589701000, 1790589701000, '{"parentID":"","role":"assistant","mode":"build","agent":"build","path":{"cwd":"/Users/sam/lighthouse-ui","root":"/Users/sam/lighthouse-ui"},"cost":0,"tokens":{"total":0,"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"modelID":"gpt-5.4","providerID":"openai","time":{"created":1790589701000}}');
