import { Replace } from "lucide-react"
import { currentEditor, definePlugin } from "@vaultite"

// Find and replace, ⌘F (⌥⌘F replaces; ⌘H is the Mac's Hide), in every editor; read-only ones
// only find. Where no text file is on screen, ⌘F is left to the browser.
let loading: Promise<typeof import("./FindBar")> | null = null
const load = () => (loading ??= import("./FindBar"))

const open = (replace: boolean) => {
  const ed = currentEditor()
  if (ed) load().then((m) => m.openFind(ed.view, replace))
}

export default definePlugin({
  editor: async () => (await load()).findExtension,
  commands: [
    { id: "find:open", name: "Search current file", keys: ["Mod+F"], when: () => !!currentEditor(), run: () => open(false) },
    { id: "find:replace", name: "Search and replace in current file", keys: ["Mod+Alt+F"], when: () => !!currentEditor() && !currentEditor()!.view.state.readOnly, run: () => open(true), icon: Replace },
  ],
})
