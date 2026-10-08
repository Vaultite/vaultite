## Hermes
Read live from Hermes Agent's files on the machine the server runs on (`~/.hermes`, or `HERMES_HOME`; each profile in
`profiles/<name>` is an account: `account: <name>`, `default` for the main home); nothing is written to the vault. Cost is
what Hermes recorded (charged, else its estimate), counted on the day its session last used each model; a compressed or
delegated session counts in the one it started from. `hermes-memory` shows SOUL.md and each `§` entry of MEMORY.md and
USER.md, `hermes-cron` its scheduled jobs (`cron/jobs.json`), both read only. A session's conversation, as JSON:
`GET /api/hermes/session/<session id>?limit=150&before=<n>`. `vau hermes connect` gives Hermes the vault's tools.
