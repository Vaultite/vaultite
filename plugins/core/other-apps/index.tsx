import { useEffect } from "react"
import { definePlugin, dismissNotice, folderOf, notify, op, openPluginSettings, plural, type Store } from "@vaultite"
import { OtherPlugins } from "./Plugins"
import { obsidianLink } from "./uri"
import "./types"

const settings = (s: Store) => s.obsidian ?? null

function Offer({ store }: { store: Store }) {
  const n = store.obsidianOffer
  useEffect(() => {
    if (!n) return
    void op("other-apps.offered").catch(() => {})
    notify(`This vault has ${plural(n, "plugin")} from another app: run them here?`, { id: "other-apps:offer", duration: 30_000,
      action: { label: "Review", run: () => openPluginSettings("other-apps") } })
  }, [n])
  useEffect(() => { if (store.obsidianRunning) dismissNotice("other-apps:offer") }, [store.obsidianRunning])
  return null
}

export default definePlugin({
  settingsPanel: () => <OtherPlugins />,
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
    editor: (s) => {
      const o = settings(s)
      if (!o) return undefined
      const { spellcheck, useTab, tabSize, autoPairBrackets, autoPairMarkdown, readableLineLength, propertiesInDocument, defaultView, editingMode } = o
      return { spellcheck, useTab, tabSize, autoPairBrackets, autoPairMarkdown, readableLineLength, propertiesInDocument, defaultView, editingMode }
    },
  },
})
