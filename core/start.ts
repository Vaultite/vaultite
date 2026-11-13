import fs from "node:fs"
import * as B from "./bundles.ts"
import { CODING_AGENTS } from "./coreops/ai.ts"
import { agentName, KNOWN_AGENTS } from "./terminalids.ts"

const START_HERE = "Start here.md", HOW = "How this vault works.md"

/** `handle`: what calls it in a note (@claude), null when the companion doesn't run it. */
type Agent = { name: string; bin: string; handle: string | null }

const startHere = (a: Agent | null) => `This vault is a folder of Markdown files. Vaultite shows them${a ? `, any other editor opens them too, and ${a.name} can work on them` : ", and any other editor opens them too"}.
${a?.handle ? `
## Try this

Write this on a new line and press Enter:

\`@${a.handle} what can I do with this vault?\`

${a.name}'s cursor shows up in this note, and it answers here.
` : ""}
## Find your way

- ⌘O finds any file, ⌘P runs any command, ⌘N makes a note (Ctrl on Windows and Linux).
- ⌥⌘D opens today's daily note, ⌘G the graph of your notes and their links.
- Settings > Appearance picks a layout: Standard, Zen or Browser.
- Plugins turns on one feature at a time.
${a ? `- In a terminal (Open terminal, from ⌘P), \`${a.bin}\` runs ${a.name} in this folder, with the vault's rules.
- Settings > AI connects Claude, ChatGPT, Muse and Grok Bot to this vault, on the web and on your phone.
` : ""}- [[How this vault works]]: what a note can hold, and how notes connect.
- Delete this note when you're done with it.
`

const howItWorks = (a: Agent | null) => `A vault is a folder of plain Markdown files. There's no database: open any file in another editor and it reads fine. To see how each piece below is written, switch to editing (⌘E, or Ctrl+E) and put the cursor on it.

${a ? `## What a file is

What a file is comes from the \`type:\` in its properties (a log, a person, a project), never its folder, so put things wherever you like. A file without one is a plain note. The pages plugins add (a dashboard, a list) live in \`Dashboards/\`.

> [!tip] ${a.name} follows the same rules
> The app gives any agent it starts the vault's rules (\`.vaultite/AGENTS.md\`: a line from each plugin that's on, then your own rules at its end), and each kind of file's format on demand. AGENTS.md and CLAUDE.md in this folder point agents started elsewhere at them too.

` : ""}## Links and embeds

Links go to files ([[Start here]]), headings ([[How this vault works#Tasks]]) or a single line ([[How this vault works#^one-line]]). A line can end with an id like this one, so a link goes to just that line. ^one-line

An embed shows another note's section in place:

![[Start here#Find your way]]

## Properties

A note's properties are the \`key: value\` lines between \`---\` at its very top, as in Obsidian: its tags, a date, a status. The app shows them under the title.

## Daily notes and templates

⌥⌘D (Ctrl+Alt+D) opens today's note, named by its date. Notes in a \`Templates\` folder are templates: Insert template (from ⌘P) puts one in the note you're writing, its \`{{date}}\` and \`{{title}}\` filled in.

## The graph

⌘G (Ctrl+G) draws your notes and the links between them. This note and [[Start here]] link to each other, so they show joined.

## Tasks

- [x] Make a vault
- [ ] ${a ? `Ask ${a.name} to make a note` : "Make a note of your own"}
- [ ] Delete these two notes when you're done with them

## Math and diagrams

$$
\\text{notes a year} = 3 \\text{ a day} \\times 365 = 1095
$$

\`\`\`mermaid
flowchart LR
  A[${a ? `You or ${a.name} write` : "You write"}] --> B[Markdown files]
  B --> C[Pages in the app]
  B --> D[Any other editor]
\`\`\`

## More

> [!info]- A folded callout
> Click the title to open it. Callout types: note, tip, info, warning, danger, quote and more.

A footnote goes after a word[^1]. ==Highlights==, ~~strikethrough~~ and \`%%comments%%\` work too. %%This one is hidden when reading.%%

[^1]: Footnotes are numbered and listed at the end.
`

export async function setUpNew(host: B.Host) {
  // (a list of pins first: the pages of the plugins Standard turns on aren't all pinned, as a vault without one would be)
  await host.call("PATCH", "config/pages", { pinned: [] })
  await B.apply(B.find(host.vault, B.DEFAULT_BUNDLE), host, null, false, { remember: false })
}

/** With `agent`: its page, Agent files' pointers, and the two notes rewritten while they're still as written. */
export async function starter(host: B.Host, { agent = null }: { agent?: string | null } = {}) {
  const wrote: string[] = []
  // (a note as written: its body, under the properties its save added)
  const parts = (rel: string) => { try { const t = fs.readFileSync(host.vault.abs(rel), "utf8"), fm = /^---\n[\s\S]*?\n---\n\n?/.exec(t)?.[0] ?? ""; return { fm, body: t.slice(fm.length) } } catch { return null } }
  const textOf = (rel: string) => parts(rel)?.body ?? null
  const put = async (rel: string, text: string) => { await host.call("PUT", "file", { path: rel, text: (parts(rel)?.fm ?? "") + text }); wrote.push(rel) }
  if (!agent) {
    if (textOf(START_HERE) === null) {
      await put(START_HERE, startHere(null))
      await host.call("POST", "pins", { path: START_HERE })
    }
    if (textOf(HOW) === null) await put(HOW, howItWorks(null))
    return wrote
  }
  const a = agentOf(host, agent)
  if (!a || textOf(START_HERE) !== startHere(null)) return wrote
  wrote.push(...host.writePages({ pin: false, only: [agent] }))
  await host.call("POST", "ops/plugin.grant", { id: "agent-files" })
  await host.call("PATCH", "config/plugin/agent-files", { rootFiles: true })
  wrote.push("AGENTS.md", "CLAUDE.md")
  await put(START_HERE, startHere(a))
  if (textOf(HOW) === howItWorks(null)) await put(HOW, howItWorks(a))
  return wrote
}

function agentOf(host: B.Host, id: string): Agent | null {
  const v = host.vault, off = v.switchedOff(), known = CODING_AGENTS.find((x) => x.id === id), name = agentName(id)
  if (!known || !name || v.config("plugins").ai === false || off.has(id) || !host.plugins().some((p) => p.id === id)) return null
  const companion = host.plugins().find((p) => p.id === "companion")
  const runs = companion && !off.has("companion") ? String(v.config("plugins/companion/data").agent || (companion.manifest.settings as { agent?: { default?: string } } | undefined)?.agent?.default || "") : ""
  const same = KNOWN_AGENTS.find((x) => x.id === id), callsIt = !!runs && (runs === same?.terminal || runs === id || agentName(runs) === name)
  return { name, bin: known.bin, handle: callsIt ? runs : null }
}
