## Token count (`max_tokens`)
Every Markdown file has a token limit; agent files a stricter one. Over it, the app marks the file (red in the status
bar and the file tree, listed in the Agent context panel): it only warns, nothing stops a save. Keep the files agents
load at startup (CLAUDE.md, AGENTS.md, ME.md, skills) short: move detail into files read when needed.
- `max_tokens: 4000` in a file's frontmatter is its own limit (`0`: none). Set it only when the user asks.
- A CLAUDE.md or AGENTS.md counts with its `@path` imports (followed 4 deep, as Claude Code does): that total is held to
  its limit too.
- `vau size` lists what's over or near its limit and what each loads; `vau size <file>` one file.

Defaults (tokens, estimated like the status bar): any file 10k (Claude Code's large-file warning was 40k characters);
CLAUDE.md, AGENTS.md, ME.md, SOUL.md 3k (Claude Code: under 200 lines, imports included); SKILL.md 5k (skills: body
under 500 lines); MEMORY.md 6k (Claude Code loads its first 200 lines or 25KB); `.vaultite/AGENTS.md` 1k. Sources:
code.claude.com/docs/en/memory, Agent Skills best practices, Codex (32 KiB of AGENTS.md in all), OpenClaw (20,000
characters a file, 60,000 in all), Hermes (20,000 characters at least).

A Claude Code hook that tells the agent when its edit takes a file over its limit (the vault's `.claude/settings.json`,
Claude Code started in the vault):
```json
{"hooks": {"PostToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command",
  "command": "f=$(jq -r '.tool_input.file_path // empty'); case \"$f\" in *.md) out=$(vau size \"${f#\"$CLAUDE_PROJECT_DIR\"/}\" --over 2>/dev/null); [ -n \"$out\" ] && { echo \"$out\" >&2; exit 2; };; esac; exit 0"}]}]}}
```
