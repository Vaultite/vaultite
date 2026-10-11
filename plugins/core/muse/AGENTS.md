## Muse
Read live from a Muse agent's home folder (a personal AI with its own VM, named by the user: `IDENTITY.md`'s name),
nothing written to the vault. Where: the blocks' `machine:` (an agent machine in Machines, read through its file agent:
`GET /api/machines/<id>/fs/...`), else `MUSE_HOME` or this machine's home folder when it's a Muse home, else the first
agent machine with one. A home has `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `PROACTIVE_PREFERENCES.md`,
`HEARTBEAT.md`, `memory/<date>.md` (facts it extracted: `- [fact|high] ...` with a quote), `memory/bank/*.md`,
`dreams/<date>.md` (a nightly reflection) and `dreams/alignment/derived/ALIGNMENT_SYNTHESIS.md`,
`agents/agent-<id>/sessions/<id>.jsonl` (a run: `item` lines of messages, thinking, function calls; `source` says what
started it), `workspace/cron.d/<cadence>/*.md` (its jobs), `workspace/feed/research/<id>/<date>-<slot>-<hash>/<beat>.md`
(its feed) and `config/skills.yaml` (connectors). The user talks to it in Muse's own apps; its replies there aren't in
these files. As JSON (this machine's owner only): `GET /api/muse?machine=` (who it is, its setup and counts),
`muse/runs?limit=`, `muse/memory?notes=`, `muse/dreams?dreams=`, `muse/feed?stories=`, and a run's conversation
`muse/session/<machine>:<run id>?limit=`. Every 30 minutes (setting `inbox`) a new dream, the day's facts and a new feed
story go to the Inbox (source `muse`, one event each, keyed so it's replaced, not repeated).
