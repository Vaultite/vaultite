import { Search } from "lucide-react"
import { allPanes, definePlugin, getTabLayout, openView, QueryResults, SearchPage, selectedText, SidebarSearch } from "@vaultite"

const openSearchTab = () => {
  const open = allPanes(getTabLayout()).find((p) => p.to === "view:search" || p.to.startsWith("view:search/"))
  openView(open?.to ?? "search", { newTab: !open })
}

export default definePlugin({
  sidebar: { search: { title: "Search field", heading: false, sort: 0, view: "search", render: (ctx) => <SidebarSearch {...ctx} /> } },
  fences: { query: (ctx) => <QueryResults store={ctx.store} text={ctx.text} /> },
  views: {
    search: {
      icon: Search, argState: true,
      pinAs: () => null,
      title: (q) => (q ? `Search: ${q}` : "Search"),
      render: ({ store, arg, setArg }) => <SearchPage store={store} query={arg} setQuery={setArg} />,
    },
  },
  slash: () => [{
    id: "search:query", title: "Search results", section: "Blocks", keywords: "query search embed results obsidian", detail: "A search, inline", line: true,
    run: (put) => put("```query\n\n```\n"),
  }],
  commands: [
    { id: "search:open-tab", name: "Open search in a tab", keys: ["Mod+Shift+F"], run: openSearchTab, fromLink: true },
    { id: "search:selection", name: "Search for selected text", when: () => !!selectedText().trim(), run: () => openView(`search/${selectedText().replace(/\s+/g, " ").trim()}`) },
  ],
})
