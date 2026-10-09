// Vaults from other apps: a vault another app also opens keeps its settings, and the app follows the ones that mean the
// same here (`conventions`: new notes, links, the editor; attachments and more through the server's
// setting-defaults). Only keys .obsidian/ sets change anything.
import { useEffect } from "react"
import { definePlugin, dismissNotice, folderOf, notify, op, openPluginSettings, type Store } from "@vaultite"
import { OtherPlugins } from "./Plugins"
import { obsidianLink } from "./uri"
import "./types"

const settings = (s: Store) => s.obsidian ?? null

/** A vault with another app's plugins, opened here: offered once to run them (its sheet does it). */
function Offer({ store }: { store: Store }) {
  const n = store.obsidianOffer
  useEffect(() => {
    if (!n) return
    void op("other-apps.offered").catch(() => {})
    notify(`This vault has ${n} plugin${n === 1 ? "" : "s"} from another app: run them here?`, { id: "other-apps:offer", duration: 30_000,
      action: { label: "Review", run: () => openPluginSettings("other-apps") } })
  }, [n])
  // (taken up elsewhere: what runs them came on)
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
    markdownLinks: (s) => settings(s)?.useMarkdownLinks,
    editor: (s) => {
      const o = settings(s)
      if (!o) return undefined
      const { spellcheck, useTab, tabSize, autoPairBrackets, autoPairMarkdown, readableLineLength, propertiesInDocument } = o
      return { spellcheck, useTab, tabSize, autoPairBrackets, autoPairMarkdown, readableLineLength, propertiesInDocument }
    },
  },
})
