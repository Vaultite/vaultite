## Interactive pages (`*.html`)
**Interactive pages are HTML files** (artifacts, like Claude's): a dashboard, a calculator, a chart, anything a
Markdown page can't do. The app runs them sandboxed: no network, no access to the app. They read the vault through
`vau`, which the app gives every artifact:
- `await vau.csv("Transactions.csv")` (records), `vau.read(path)` (text), `vau.json(path)`, `vau.files(prefix)`;
  paths are relative to the artifact's folder, or from the vault's top with a leading `/`. `fetch("Transactions.csv")`
  works too. Read the data every time: don't copy it into the HTML, so the page never goes stale.
- `vau.on("change", paths => ...)` redraws when a file it read changes (without it, the page reloads).
- `localStorage` works and is kept in the vault (filters, a view); links open in the app or a new tab.
- Colours: follow the app's light and dark with `:root[data-theme="dark"]`, or use its colours, `var(--vau-background)`,
  `--vau-foreground`, `--vau-card`, `--vau-border`, `--vau-muted-foreground`, `--vau-blue`, `--vau-green`, `--vau-red`...
- Libraries and fonts from public CDNs (jsdelivr, unpkg, cdnjs, esm.sh, Google Fonts) work; other hosts don't.
- `<title>` is its name in the app; `<meta name="vaultite:icon" content="wallet">` (a lucide name) and
  `<meta name="vaultite:tint" content="green">` its icon when pinned. Make it work on a phone (390px wide).
- Show one inside any Markdown file with `![[Spending.html]]` on a line of its own (`![[Spending.html|400]]`: 400px
  tall); the same works for a CSV. To add one to the sidebar, add its path to `pinned` in `.vaultite/pages.json` (Pinned).
- `/api/render?path=Finance/Spending.html` gives its title, its text and the files it reads (not what its code
  draws: read those files to answer questions about it).
