// Obsidian: a vault Obsidian also opens keeps its settings, and the app follows the ones that mean the same here
// (`conventions`: new notes, attachments, Markdown links). Only keys .obsidian/app.json sets change anything.
import { useEffect } from "react"
import { Gem } from "lucide-react"
import { definePlugin, dismissNotice, folderOf, notify, op, openPluginSettings, type Store } from "@vaultite"
import { ObsidianPlugins } from "./Plugins"
import { obsidianLink } from "./uri"
import "./types"

const settings = (s: Store) => s.obsidian ?? null

/** An Obsidian vault with plugins, opened here: offered once to run them (its sheet does it). */
function Offer({ store }: { store: Store }) {
  const n = store.obsidianOffer
  useEffect(() => {
    if (!n) return
    void op("obsidian.offered").catch(() => {})
    notify(`Your Obsidian vault has ${n} plugin${n === 1 ? "" : "s"}: run them here?`, { id: "obsidian:offer", duration: 30_000,
      action: { label: "Review", run: () => openPluginSettings("obsidian") } })
  }, [n])
  // (taken up elsewhere: what runs them came on)
  useEffect(() => { if (store.obsidianRunning) dismissNotice("obsidian:offer") }, [store.obsidianRunning])
  return null
}

export default definePlugin({
  icon: Gem,
  settingsPanel: () => <ObsidianPlugins />,
  background: ({ store }) => <Offer store={store} />,
  schemeLink: obsidianLink,
  conventions: {
    newNoteFolder: (s, from) => {
      const o = settings(s)
      switch (o?.newFileLocation) {
        case "root": return ""
        case "current": return from && !from.startsWith("/") ? folderOf(from) : ""
        case "folder": return o.newFileFolderPath ?? ""
      }
      return undefined
    },
    // "/" the top, "./" beside the note, "./sub" a folder beside it, else a folder
    attachmentFolder: (s, from) => {
      const p = settings(s)?.attachmentFolderPath
      if (p === undefined) return undefined
      const here = folderOf(from)
      if (p === "/" || p === "") return ""
      if (p === "./" || p === ".") return here
      if (p.startsWith("./")) return [here, p.slice(2).replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/")
      return p.replace(/^\/+|\/+$/g, "")
    },
    markdownLinks: (s) => settings(s)?.useMarkdownLinks,
  },
})
