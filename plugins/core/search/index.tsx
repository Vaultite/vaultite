import { Search } from "lucide-react"
import { definePlugin, isViewOpen, openView, SearchPage, selectedText, SidebarSearch } from "@vaultite"

// The sidebar's search field, and search as a full page in a tab (view:search/<query>, like VS Code's search editor:
// names, then every matching line in files). The quick switcher itself is the core's (⌘O): the field only opens it.
export default definePlugin({
  sidebar: { search: { title: "Search field", heading: false, sort: 0, view: "search", render: (ctx) => <SidebarSearch {...ctx} /> } },
  views: {
    search: {
      icon: Search, argState: true,
      title: (q) => (q ? `Search: ${q}` : "Search"),
      render: ({ store, arg, setArg }) => <SearchPage store={store} query={arg} setQuery={setArg} />,
    },
  },
  commands: [
    { id: "search:open-tab", name: "Open search in a tab", keys: ["Mod+Shift+F"], run: () => (isViewOpen("search") ? openView("search") : openView("search", { newTab: true })) },
    // (the editor's right-click menu has it as Search for "…")
    { id: "search:selection", name: "Search for selected text", when: () => !!selectedText().trim(), run: () => openView(`search/${selectedText().replace(/\s+/g, " ").trim()}`) },
  ],
})
