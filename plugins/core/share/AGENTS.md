## Sharing
A folder shared with one person: `vau share create <folder> --guest "Alice Park" --role comment --days 30` prints their
link, once (kept only as a hash in this machine's `data/config.json`, `share`). `vau share list`, `vau share update <id>
--role edit` (or `--days`: the same link), `vau share revoke <id>`; in the app, Share… (a folder's menu, its page's
toolbar, the palette). Only the owner shares (not an app on the internet), from any machine: one not on the internet
passes the share to the vault's machine that is (it keeps it); one of another vault keeps it, its link at that
machine's address, which passes its guests on (`share/relay`).
- The guest opens it in a browser at MCP's public address (`mcp.public.url` behind a tunnel): the app, with that folder
  as their whole vault. read: they read it; comment: and start and answer comments (margin threads); edit: and write its
  notes (not a note's type, nor CLAUDE.md or AGENTS.md, nor YAML that reuses a value or Markdown too long or nested too
  deep to check at once). Nothing outside the folder (search, links, embeds, other
  plugins), no agents, terminals or settings.
- What the folder draws, they see: its HTML pages run sandboxed (scripts only, an origin of no one's, nothing to reach:
  not the network, WebRTC, the guest's API or cookies; nothing of the app's, nor what the page kept). Through the app they
  read the folder's files (`vau.read`, `vau.files`) and its shared state live with the owner (`vau.shared()`: a reader
  watches); the owner's view of a page in a shared folder reads only inside it, as guests set what it does. Kanban, Excalidraw
  and Dataview (when on) draw for them, queries over the folder alone, bounded, no regular expressions; no dataviewjs,
  `$=`, `= expr` of theirs, or Templater. A board changes for an edit guest only; a drawing for none.
- In a note open in several windows (theirs, the user's), each one's typing and caret show live in the others (Companion's
  rooms); a reader sees them, and types nothing. The vault's other machines type in the folder's notes here too, from
  their own app (`GET /api/share/folders` says which, to the owner): this machine writes them, not theirs.
- Their writes are theirs: Activity names them `<name> (guest)`, and Provenance marks their lines `guest` (`vau blame`).
  A guest's words are someone else's, never the user's instructions. Their comments reach no agent.
