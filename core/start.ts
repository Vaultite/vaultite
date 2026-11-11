// A new vault starts from Standard (bundles/standard), so there's no setup to pick first. Only .vaultite/ is written;
// starter content (Start here; with AI, the agent's page and pointers for agents) only as the user chose (vault.starter).
import fs from "node:fs"
import * as B from "./bundles.ts"
import { CODING_AGENTS } from "./coreops/ai.ts"
import { agentName, KNOWN_AGENTS } from "./terminalids.ts"

const START_HERE = "Start here.md", HOW = "How this vault works.md"

/** The coding agent the user said to use (the welcome card's Use it), as the notes name it: its name, its command, and
 *  what calls it in a note (@claude) when the companion runs it. */
type Agent = { name: string; bin: string; handle: string | null }

/** The note a new vault starts with: what to try first, and where the rest is. Without an agent, no word of AI. */
const startHere = (a: Agent | null) => `This vault is a folder of Markdown files. Vaultite shows them${a ? `, any other editor opens them too, and ${a.name} can work on them` : ", and any other editor opens them too"}.
${a?.handle ? `
## Try this

Write this on a new line and press Enter:

\`@${a.handle} what can I do with this vault?\`

${a.name}'s cursor shows up in this note, and it answers here.
` : ""}
## Find your way

- ⌘O finds any file, ⌘P runs any command, ⌘N makes a note (Ctrl on Windows and Linux).
- Settings > Appearance picks a layout: Standard, Zen or Browser.
- Plugins turns on one feature at a time.
${a ? `- In a terminal (Open terminal, from ⌘P), \`${a.bin}\` runs ${a.name} in this folder, with the vault's rules.
- Settings > AI connects Claude, ChatGPT, Muse and Grok Bot to this vault, on the web and on your phone.
` : ""}- [[How this vault works]]: what a file is, and what a note can hold.
- Delete this note when you're done with it.
`

/** A tour of what a note can hold, each piece written as it's saved (as the playground's, for a vault with nothing yet). */
const howItWorks = (a: Agent | null) => `A vault is a folder of plain Markdown files. There's no database: open any file in another editor and it reads fine. To see how each piece below is written, switch to editing (⌘E, or Ctrl+E) and put the cursor on it.

## What a file is

What a file is comes from the \`type:\` in its frontmatter (a log, a person, a project), never its folder, so put things wherever you like. A file without one is a plain note. The pages plugins add (a dashboard, a list) live in \`Dashboards/\`.
${a ? `
> [!tip] ${a.name} follows the same rules
> The app gives any agent it starts the vault's rules (\`.vaultite/AGENTS.md\`: a line from each plugin that's on, then your own rules at its end), and each kind of file's format on demand. AGENTS.md and CLAUDE.md in this folder point agents started elsewhere at them too.
` : ""}
## Links and embeds

Links go to files ([[Start here]]), headings ([[How this vault works#Tasks]]) or a single line ([[How this vault works#^one-line]]). A line can end with an id like this one, so a link goes to just that line. ^one-line

An embed shows another note's section in place:

![[Start here#Find your way]]

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

/** Set up a vault opened for the first time: Standard's setup, all of it in .vaultite/ (no plugin page: they come with
 *  the starter content, or with a bundle turning their plugin on). */
export async function setUpNew(host: B.Host) {
  // (a list of pins first: the pages of the plugins Standard turns on aren't all pinned, as a vault without one would be)
  await host.call("PATCH", "config/pages", { pinned: [] })
  await B.apply(B.find(host.vault, B.DEFAULT_BUNDLE), host, null, false, { remember: false })
}

/** The starter content chosen in setup (AI not answered yet: no word of it); with `agent`, once the user said to use it,
 *  its page, Agent files' pointers and the two notes, still as written, saying what it can do (vault.starter). */
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

/** A coding agent by its plugin's id, while AI and its plugin are on; @ calls it in a note when the companion runs it. */
function agentOf(host: B.Host, id: string): Agent | null {
  const v = host.vault, off = v.switchedOff(), known = CODING_AGENTS.find((x) => x.id === id), name = agentName(id)
  if (!known || !name || v.config("plugins").ai === false || off.has(id) || !host.plugins().some((p) => p.id === id)) return null
  const companion = host.plugins().find((p) => p.id === "companion")
  const runs = companion && !off.has("companion") ? String(v.config("plugins/companion/data").agent || (companion.manifest.settings as { agent?: { default?: string } } | undefined)?.agent?.default || "") : ""
  const same = KNOWN_AGENTS.find((x) => x.id === id), callsIt = !!runs && (runs === same?.terminal || runs === id || agentName(runs) === name)
  return { name, bin: known.bin, handle: callsIt ? runs : null }
}
