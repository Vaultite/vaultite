// A new vault starts from Standard (bundles/standard), so there's no setup to pick first. Only .vaultite/ is written;
// starter content (a Start here note, pointers for agents) only when the user chose it in setup (vault.starter).
import fs from "node:fs"
import * as B from "./bundles.ts"

const START_HERE = "Start here.md"

/** The note a new vault starts with: what to try first, and where the rest is. */
const startHere = () => `This vault is a folder of Markdown files. Vaultite shows them, any other editor opens them too, and an AI can work on them.

## Try this

Open a terminal (⌘P, or Ctrl+P off a Mac, then Open terminal) and run \`claude\`, or another coding agent. It starts in this folder and reads the vault's rules. Ask it: "Make a note with three ideas for this weekend." The note shows up in Files.

## Next

- ⌘O (Ctrl+O) finds any file, ⌘P (Ctrl+P) runs any command.
- Settings, Bundles turns on a whole setup at once: Life OS for your days, people and health. Settings, Plugins turns on one feature at a time.
- Settings, Connections puts Claude, ChatGPT, Muse and Grok Bot in this vault, on the web and on your phone.
- Delete this note when you're done with it.
`

/** Set up a vault opened for the first time: Standard's setup, all of it in .vaultite/ (its plugins' pages come with
 *  the starter content, or a setup picked). */
export async function setUpNew(host: B.Host) {
  // (a list of pins first: the pages of the plugins Standard turns on aren't all pinned, as a vault without one would be)
  await host.call("PATCH", "config/pages", { pinned: [] })
  await B.apply(B.find(host.vault, B.DEFAULT_BUNDLE), host, null, false, { remember: false, pages: false })
}

/** The starter content, chosen in setup: a pinned Start here note, its plugins' pages (unpinned), and a line in
 *  AGENTS.md and CLAUDE.md pointing agents at the vault's rules (Agent files, allowed to keep them). Returns what it wrote. */
export async function starter(host: B.Host) {
  const wrote: string[] = [...host.writePages?.({ pin: false }) ?? []]
  await host.call("POST", "ops/plugin.grant", { id: "agent-files" })
  await host.call("PATCH", "config/plugin/agent-files", { rootFiles: true })
  wrote.push("AGENTS.md", "CLAUDE.md")
  if (!fs.existsSync(host.vault.abs(START_HERE))) {
    await host.call("PUT", "file", { path: START_HERE, text: startHere() })
    await host.call("POST", "pins", { path: START_HERE })
    wrote.push(START_HERE)
  }
  return wrote
}
