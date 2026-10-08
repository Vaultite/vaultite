// A vault the app opens for the first time starts from Minimal (bundles/minimal), so there's no setup to pick first:
// more is a bundle or a plugin away. One that was empty (a new vault) also gets a Start here note, pinned.
import * as B from "./bundles.ts"

export const START_HERE = "Start here.md"

/** The note a new vault starts with: what to try first, and where the rest is. */
export const startHere = () => `This vault is a folder of Markdown files. Vaultite shows them, any other editor opens them too, and an AI can work on them.

## Try this

Open a terminal (⌘P, or Ctrl+P off a Mac, then Open terminal) and run \`claude\`, or another coding agent. It starts in this folder and reads the vault's rules. Ask it: "Make a note with three ideas for this weekend." The note shows up in Files.

## Next

- ⌘O (Ctrl+O) finds any file, ⌘P (Ctrl+P) runs any command.
- Settings, Bundles turns on a whole setup at once: Life OS for your days, people and health. Settings, Plugins turns on one feature at a time.
- The MCP plugin lets claude.ai and ChatGPT use this vault, on the web and on your phone.
- Delete this note when you're done with it.
`

/** Set up a vault opened for the first time. `empty`: nothing was in its folder (a new vault), so it gets the note, and
 *  agents started outside the app are pointed at its rules (a CLAUDE.md and an AGENTS.md: nothing of the user's yet). */
export async function setUpNew(host: B.Host, empty: boolean) {
  // The plugins' pages stay out of the user's files (.vaultite/pages/): a Minimal vault is only its notes.
  await host.call("PATCH", "config/pages", { install: false })
  await B.apply(B.find(host.vault, B.DEFAULT_BUNDLE), host, null, false, { remember: false })
  if (!empty) return
  await host.call("PATCH", "config/plugin/agent-files", { rootFiles: true })
  await host.call("PUT", "file", { path: START_HERE, text: startHere() })
  await host.call("POST", "pins", { path: START_HERE })
}
