import { Link2, NotebookPen } from "lucide-react"
import { definePlugin, openView } from "@vaultite"
import { LinksPanel, LinksView, openPageNote } from "./Links"

export default definePlugin({
  sidebar: { links: { title: "Links", heading: false, needsHeading: true, sort: 40, hidden: true, view: "links", flyout: { icon: Link2 }, render: (ctx) => <LinksPanel {...ctx} /> } },
  views: {
    links: { icon: Link2, title: () => "Links", render: ({ store }) => <LinksView store={store} /> },
  },
  webPageActions: ({ url, title }) => [{ label: "Note on this page", icon: NotebookPen, run: () => void openPageNote(url, title) }],
  commands: [
    { id: "backlinks:open-tab", name: "Open links in a tab", run: () => openView("links", { newTab: true }) },
    { id: "backlinks:open-split", desktop: true, name: "Open links in right split", run: () => openView("links", { split: true }) },
  ],
})
