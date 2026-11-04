# Notes for `plugins/core/cloud-sessions/`

- Read by the desktop app (electron/cloud.ts) from claude.ai's JSON API with a Browser profile's cookies, never from
  its pages' DOM, which changes. Nothing is asked until the user's yes (`read`): before it, only cookies are looked at,
  to know whether to ask.
- `/v1/sessions` (with its `ccr-byoc` beta and `x-organization-uuid`) is the list claude.ai's own sidebar reads, with
  `session_status`, `post_turn_summary` (where it stands, its question) and the repositories and branches; archive,
  unarchive (Undo) and rename are `POST /v1/sessions/<id>/archive`, `/unarchive` and `PATCH /v1/sessions/<id>`. Each
  organization with claude.ai's apps is read once, in the first profile that has it; one that turns it away (403: no
  Claude Code there) isn't listed. Pull requests come from GitHub through the user's `gh`, when it's installed.
- A session opens in its account's logins: this workspace's when it has them, else a container's, else the workspace
  that has them is switched to. A tab without a container has its workspace's logins, so never open one bare.
- claude.ai/code takes a prompt in `?q=`, waiting in its box: a session is never started without the user sending it.
- Continue in a terminal is Claude Code's `claude-code.teleport` (its teleport.ts): shown only when an account here is
  signed in to the session's organization (`GET /api/claude-code/organizations`).
- QA: web/qa/webwatch.mjs, against a made-up claude.ai.
