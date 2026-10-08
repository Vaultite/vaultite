import { Link2 } from "lucide-react"
import { definePlugin, openView } from "@vaultite"
import { LinksPanel, LinksView } from "./Links"

// The links of the file you're on: a sidebar panel (desktop), and the same as a tab that follows the other panes' file,
// to keep in a split. The link index itself is the core's (core/links.ts); unlinked mentions come from plugin.ts.
export default definePlugin({
  icon: Link2,
  // Hidden until shown (the sidebar's right-click menu); in the rail, its icon opens it as a flyout.
  sidebar: { links: { title: "Links", heading: false, sort: 40, hidden: true, view: "links", flyout: { icon: Link2 }, render: (ctx) => <LinksPanel {...ctx} /> } },
  views: {
    links: { icon: Link2, title: () => "Links", render: ({ store }) => <LinksView store={store} /> },
  },
  commands: [
    { id: "backlinks:open-tab", name: "Open links in a tab", run: () => openView("links", { newTab: true }) },
    { id: "backlinks:open-split", desktop: true, name: "Open links in right split", run: () => openView("links", { split: true }) },
  ],
})
