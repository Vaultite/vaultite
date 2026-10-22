# Notes for `plugins/core/cloud-sessions/`

- Read by the desktop app (electron/web.ts, CLOUD) from claude.ai's JSON API with a Browser profile's cookies, never from
  its pages' DOM, which changes. Nothing is asked until the user's yes (`read`): before it, only cookies are looked at,
  to know whether to ask.
- `/v1/sessions` (with its `ccr-byoc` beta and `x-organization-uuid`) is the list claude.ai's own sidebar reads, with
  `session_status`; `/v1/code/sessions` no longer says whether one is working. Each organization with claude.ai's
  apps is read once, in the first profile that has it; one that turns it away (403: no Claude Code there) isn't listed.
- A session opens in its account's logins: this workspace's when it has them, else a container's, else the workspace
  that has them is switched to. A tab without a container has its workspace's logins, so never open one bare.
- claude.ai/code takes a prompt in `?q=`, waiting in its box: a session is never started without the user sending it.
- QA: web/qa/webwatch.mjs, against a made-up claude.ai.
