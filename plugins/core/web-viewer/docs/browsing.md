## Browsing: using the browser well

Each call is a turn of yours, the slow part: let each answer do the work. MCP tools are the same ops (`browser_open`, `browser_act`...).

- **Open, then act on what it answers.** `vau browser open <url> --task "<2-3 words>" --summary "<what for>"` answers once the page has drawn (data it fetches included), with its content and refs, past the navigation. `act` answers what changed (`~` changed, `+` new, `-` gone), or the new page's content when it went to another: act on that, it's the page as it is. Take a `snapshot` only when an answer lacks what you need; `snapshot <tab> --find "save"` gives the lines with a word, each with what it's inside.
- **Name what you act on.** `act <tab> click --name "Save settings"` (`--role button` when names repeat) needs no snapshot first. A name that's no control's is text the page shows, clicked where it's drawn: `click --name "Goals"` puts the caret in that paragraph, `dblclick --name "recieve"` selects the word, then `act <tab> type --value "receive"` (no ref) types at the caret, over the selection.
- **A form is one call:** `act <tab> fill --fields '[{"name":"Email","value":"a@b.c"},{"name":"Time zone","value":"America/Chicago"},{"name":"Weekly digest","value":"false"}]'`, then `click --name "Save"`. fill replaces what's there; type adds.
- **Rich text** (Google Docs, Notion, Slack): `act <tab> paste --format markdown --value - < text.md` pastes it with its formatting (headings, bold, lists), at the caret or into `--name`/a ref, never through the user's clipboard.
- **Reading:** `read <tab> --main` (the page's main part), `read <tab> --find "invoice"` (the lines with it). A Google doc reads as its Markdown, a sheet as CSV, slides as text.
- **Files** (an invoice, a PDF, an export): `download <tab> <its address>` saves it into the vault with the tab's logins; `pdf <tab>` saves the page itself.
- **Several steps you needn't look between:** one `run` script (`ref(name)`, `act`, `fill`, `read`, `wait`, `go`), 30 s at most.
- **Never sleep.** open, go and act wait for the page to settle; `wait <tab> --text "Saved"` for something slower.
- **Google Docs:** `read` is the doc's Markdown. Rewrite it whole: `click --name "<some of its text>"`, `press --key Meta+a`, then `paste --format markdown --value - < doc.md`. Add at a place: `click --name "<text there>"`, `press --key End` (or `Meta+ArrowDown`, its end), `paste`. Fix words: `dblclick --name "<word>"`, `type --value "<new>"`; many: Find and replace (`press --key Meta+Shift+h`, fill its fields by name, `click --name "Replace all"`).
- **Addresses beat clicks** when you know them: `go <tab> <url>` (Gmail: `https://mail.google.com/mail/u/0/#search/<words>`; Drive: `https://drive.google.com/drive/search?q=<words>`).
- **Only the user can** sign in, pass a check or approve a passkey: `ask <tab> "<what to do>"`, then `wait <tab> --helped --timeout 600`. Logins with the user's passwords for agents: `login <tab>`.
- **Done:** `close <tab>`, unless the user would want to see it.
- `evaluate` (an expression in the page's DOM, in a world of its own) is for what none of these reach, like every link's address in a table.
