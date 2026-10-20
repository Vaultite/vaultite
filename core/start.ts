// A new vault starts from Standard (bundles/standard), so there's no setup to pick first. Only .vaultite/ is written;
// starter content (a Start here note, pointers for agents) only when the user chose it in setup (vault.starter).
import fs from "node:fs"
import * as B from "./bundles.ts"

const START_HERE = "Start here.md", HOW = "How this vault works.md"
/** The plugins whose pages a new vault starts with: the agent to talk to (the rest are a setting away). */
const STARTER_PAGES = ["claude-code", "codex"]

/** The note a new vault starts with: what to try first, and where the rest is. */
const startHere = () => `This vault is a folder of Markdown files. Vaultite shows them, any other editor opens them too, and an AI can work on them.

## Try this

With Claude Code installed, write this on a new line and press Enter:

\`@claude what can I do with this vault?\`

Its cursor shows up in this note and answers here. With Codex, set the agent in Settings > Plugins > Companion, then write \`@codex\`.

## Next

- ⌘O finds any file, ⌘P runs any command (Ctrl+O and Ctrl+P on Windows and Linux).
- Open terminal (⌘P) runs a coding agent in this folder: \`claude\`, \`codex\` or another. It reads the vault's rules.
- Settings > Bundles turns on a whole setup at once.
- Settings > Plugins turns on one feature at a time.
- Settings > Connections puts Claude, ChatGPT, Muse and Grok Bot in this vault, on the web and on your phone.
- [[How this vault works]]: what a file is, and what a note can hold.
- Delete this note when you're done with it.
`

/** A tour of what a note can hold, each piece written as it's saved (as the playground's, for a vault with nothing yet). */
const howItWorks = () => `A vault is a folder of plain Markdown files. There's no database: open any file in another editor and it reads fine. To see how each piece below is written, switch to editing (⌘E) and put the cursor on it.

## What a file is

What a file is comes from the \`type:\` in its frontmatter (a log, a person, a project), never its folder, so put things wherever you like. A file without one is a plain note. The app's pages, like [[Claude]], live in \`Dashboards/\`.

> [!tip] AIs follow the same rules
> The app gives any AI it starts the vault's rules (\`.vaultite/AGENTS.md\`: a line from each plugin that's on, then your own rules at its end), and each kind of file's format on demand. AGENTS.md and CLAUDE.md in this folder point agents started elsewhere at them too.

## Links and embeds

Links go to files ([[Start here]]), headings ([[How this vault works#Tasks]]) or a single line ([[How this vault works#^one-line]]). A line can end with an id like this one, so a link goes to just that line. ^one-line

An embed shows another note's section in place:

![[Start here#Try this]]

## Tasks

- [x] Make a vault
- [ ] Ask an AI to make a note
- [ ] Delete these two notes when you're done with them

## Math and diagrams

$$
\\text{notes a year} = 3 \\text{ a day} \\times 365 = 1095
$$

\`\`\`mermaid
flowchart LR
  A[You or an AI write] --> B[Markdown files]
  B --> C[Pages in the app]
  B --> D[Any other editor]
\`\`\`

## More

> [!info]- A folded callout
> Click the title to open it. Callout types: note, tip, info, warning, danger, quote and more.

A footnote goes after a word[^1]. ==Highlights==, ~~strikethrough~~ and \`%%comments%%\` work too. %%This one is hidden when reading.%%

[^1]: Footnotes are numbered and listed at the end.
`

/** Set up a vault opened for the first time: Standard's setup, all of it in .vaultite/ (its plugins' pages come with
 *  the starter content, or a setup picked). */
export async function setUpNew(host: B.Host) {
  // (a list of pins first: the pages of the plugins Standard turns on aren't all pinned, as a vault without one would be)
  await host.call("PATCH", "config/pages", { pinned: [] })
  await B.apply(B.find(host.vault, B.DEFAULT_BUNDLE), host, null, false, { remember: false, pages: false })
}

/** The starter content, chosen in setup: a pinned Start here, How this vault works, the agent's page, and a line in
 *  AGENTS.md and CLAUDE.md pointing agents at the vault's rules (Agent files). Returns what it wrote. */
export async function starter(host: B.Host) {
  const wrote: string[] = [...host.writePages?.({ pin: false, only: STARTER_PAGES }) ?? []]
  await host.call("POST", "ops/plugin.grant", { id: "agent-files" })
  await host.call("PATCH", "config/plugin/agent-files", { rootFiles: true })
  wrote.push("AGENTS.md", "CLAUDE.md")
  if (!fs.existsSync(host.vault.abs(START_HERE))) {
    await host.call("PUT", "file", { path: START_HERE, text: startHere() })
    await host.call("POST", "pins", { path: START_HERE })
    wrote.push(START_HERE)
  }
  if (!fs.existsSync(host.vault.abs(HOW))) {
    await host.call("PUT", "file", { path: HOW, text: howItWorks() })
    wrote.push(HOW)
  }
  return wrote
}
