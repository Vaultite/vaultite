## Tables (`*.csv`)
**Tables are CSV** (`Finance/Transactions.csv`): a header row, then one row per record. Use one when the data is many
rows of the same shape (transactions, an export); one Markdown file per thing is still right for people, notes and
logs. The app draws a CSV as a table (filter, sort by a column), named like a note (`Transactions`), and
`![[Transactions.csv]]` on a line of its own shows its rows in any Markdown file. To add one to the sidebar, add its
path to `pinned` in `.vaultite/pages.json`. `/api/render?path=...` gives its first rows as Markdown.
