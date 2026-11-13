import { FoldVertical, UnfoldVertical } from "lucide-react"
import { currentEditor, definePlugin, trackSoon } from "@vaultite"

let loading: Promise<typeof import("./fold")> | null = null
const load = () => (loading ??= import("./fold"))

const note = () => { const ed = currentEditor(); return ed?.kind === "markdown" ? ed.view : null }
const run = (what: "foldAll" | "unfoldAll" | "toggleHere") => () => {
  const v = note()
  if (v) load().then((m) => { m[what](v) })
}

export default definePlugin({
  editor: async (ctx) => (ctx.kind === "markdown" ? (await load()).foldingExtension(ctx.path, trackSoon) : []),
  commands: [
    { id: "folding:toggle", name: "Toggle fold on the current line", keys: ["Mod+Alt+["], when: () => !!note(), run: run("toggleHere") },
    { id: "folding:fold-all", name: "Fold all headings and lists", keys: ["Mod+Alt+Shift+["], when: () => !!note(), run: run("foldAll"), icon: FoldVertical },
    { id: "folding:unfold-all", name: "Unfold all headings and lists", keys: ["Mod+Alt+Shift+]"], when: () => !!note(), run: run("unfoldAll"), icon: UnfoldVertical },
  ],
})
