import { Link2, NotebookPen } from "lucide-react"
import { definePlugin, openView } from "@vaultite"
import { LinksPanel, LinksView, openPageNote } from "./Links"

// The links of the file or web page you're on: a sidebar panel (desktop), and the same as a tab that follows the other
// panes' file. The link index is the core's (core/links.ts); unlinked mentions and web pages' links are plugin.ts'.
export default definePlugin({
  // Hidden until shown (the sidebar's right-click menu); in the rail, its icon opens it as a flyout.
  sidebar: { links: { title: "Links", heading: false, sort: 40, hidden: true, view: "links", flyout: { icon: Link2 }, render: (ctx) => <LinksPanel {...ctx} /> } },
  views: {
    links: { icon: Link2, title: () => "Links", render: ({ store }) => <LinksView store={store} /> },
  },
  // A web page's note, from its … menu in the Browser: the note whose `source` it is, made if there's none.
  webPageActions: ({ url, title }) => [{ label: "Note on this page", icon: NotebookPen, run: () => void openPageNote(url, title) }],
  commands: [
    { id: "backlinks:open-tab", name: "Open links in a tab", run: () => openView("links", { newTab: true }) },
    { id: "backlinks:open-split", desktop: true, name: "Open links in right split", run: () => openView("links", { split: true }) },
  ],
})
