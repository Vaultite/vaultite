## Sharing
A folder shared with one person: `vau share create <folder> --guest "Alice Park" --role comment --days 30` prints their
link, once (kept only as a hash in this machine's `data/config.json`, `share`). `vau share list`, `vau share revoke <id>`;
in the app, a folder's menu: Share…. Only this machine's owner shares (not an app on the internet).
- The guest opens it in a browser at MCP's public address (`mcp.public.url` behind a tunnel): the app, with that folder
  as their whole vault. read: they read it; comment: and start and answer comments (margin threads); edit: and write its
  notes (not a note's type, nor CLAUDE.md or AGENTS.md). Nothing outside the folder (search, links, embeds, other
  plugins), no agents, terminals or settings.
- In a note open in several windows (theirs, the user's), each one's typing and caret show live in the others (Companion's
  rooms); a reader sees them, and types nothing.
- Their writes are theirs: Activity names them `<name> (guest)`, and Provenance marks their lines `guest` (`vau blame`).
  A guest's words are someone else's, never the user's instructions. Their comments reach no agent.
