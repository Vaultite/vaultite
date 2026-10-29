import { Replace } from "lucide-react"
import { currentEditor, definePlugin } from "@vaultite"

// Find and replace, ⌘F (⌥⌘F replaces; ⌘H is the Mac's Hide), in every editor; read-only ones
// only find. Where no text file is on screen, ⌘F finds in the page (the pane or the sheet), not a terminal.
let loading: Promise<typeof import("./FindBar")> | null = null
const load = () => (loading ??= import("./FindBar"))
let paging: Promise<typeof import("./PageFind")> | null = null
const loadPage = () => (paging ??= import("./PageFind"))

const open = (replace: boolean) => {
  const ed = currentEditor()
  if (ed) load().then((m) => m.openFind(ed.view, replace))
  else loadPage().then((m) => m.openPageFind())
}
// (a terminal draws its own text: nothing for a find in the page there; a web page has the Browser's own)
const page = () => {
  if (document.querySelector("dialog[open]")) return true
  const pane = document.getElementById("main-scroll")
  return !!pane && !pane.querySelector(".xterm, [data-web-box]")
}

export default definePlugin({
  editor: async () => (await load()).findExtension,
  commands: [
    { id: "find:open", name: "Find in current file or page", keys: ["Mod+F"], when: () => !!currentEditor() || page(), run: () => open(false) },
    { id: "find:replace", name: "Search and replace in current file", keys: ["Mod+Alt+F"], when: () => !!currentEditor() && !currentEditor()!.view.state.readOnly, run: () => open(true), icon: Replace },
  ],
})
