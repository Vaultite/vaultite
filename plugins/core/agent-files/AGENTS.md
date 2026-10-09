## Agent files
The vault's rules for AIs are `.vaultite/AGENTS.md`, written by this plugin: the app's rules, then `## Plugins` (one
line from each plugin that's on: its manifest's `forAgents`), then `## Your own rules`. Everything above that heading is
rewritten when the app updates or plugins change; what's under it is the user's and stays (add a rule for this vault
there only when the user asks; facts about the user go in their file, ME.md). With this plugin off the app stops
writing it and takes its part out (the user's own rules stay; nothing left, no file). The vault's `AGENTS.md` and
`CLAUDE.md` are the user's: the app never writes them, except one line pointing at the rules when the setting
`rootFiles` is on (`.vaultite/plugins/agent-files/data.json`, `{"rootFiles": true}`): `@.vaultite/AGENTS.md` in
CLAUDE.md, a sentence in AGENTS.md. Turned off (or the plugin off), that line goes; a file is deleted only when the app
made it for that line.
