// The Browser in the quick switcher: open web tabs and bookmarks by name, the history as it's typed, and rows that open
// what's typed as an address or search the web for it. The web app has no web tabs: only bookmarks, in the system browser.
import { Search } from "lucide-react"
import { getStore, getTabLayout, onTabLayoutChange, openWebLink, panesOf, selectTab, webPages, type PluginDef, type SearchDoc, type Store } from "@vaultite"
import { addressOf, hostOf, searchUrl } from "./address"
import { matchBookmarks } from "./bookmarks"
import { colorOf, containerById, splitArg } from "./containers"
import { extensionPageName } from "./extstate"
import { hasHistory, markTyped, searchHistory } from "./history"
import { siteIcon } from "./icons"
import { settings, titleOf } from "./state"

const TINT = "var(--muted-foreground)"
const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
const http = (u: string) => /^https?:\/\//i.test(u)

/** The web tabs of every pane here (not the one in front), each with its tab's id. */
function webTabs() {
  if (!webPages) return []
  const { root, focus } = getTabLayout()
  return panesOf(root).flatMap((g) => g.tabs.flatMap((t) => {
    if (!t.to.startsWith("view:web/") || (g.id === focus && g.active === t.id)) return []
    const { url, container } = splitArg(t.to.slice("view:web/".length))
    return http(url) ? [{ id: t.id, url, container }] : []
  }))
}

/** What the switcher finds, opening pages with `openPage` (a web tab: a new one, or the one showing it). */
export function switcherSearch(openPage: (url: string) => void): Pick<PluginDef, "search" | "searchLive" | "searchQuery"> {
  const open = (url: string, how: "typed" | "bookmark") => {
    if (!webPages) return openWebLink(url)
    markTyped(url, how)
    openPage(url)
  }
  return {
    search: (store: Store) => (store.bookmarks ?? []).map((b): SearchDoc => ({
      id: `web-bookmark-${b.url}`, title: b.title || hostOf(b.url), meta: ["Bookmark", ...b.folder.split("/").filter(Boolean), bare(b.url)].join(" · "),
      kind: "Bookmark", icon: siteIcon(b.url), tint: TINT, run: () => open(b.url, "bookmark"), text: `${b.url} ${b.folder}`, recent: 0, weight: 4,
    })),
    // (an open tab outranks notes: going to it beats opening the page again)
    searchLive: {
      subscribe: onTabLayoutChange,
      docs: () => webTabs().map((t): SearchDoc => {
        const c = containerById(t.container)
        return {
          id: `web-tab-${t.id}`, title: titleOf(t.url) || extensionPageName(t.url) || hostOf(t.url), meta: ["Switch to tab", c?.name, bare(t.url)].filter(Boolean).join(" · "),
          kind: "Tab", icon: siteIcon(t.url, c ? colorOf(c) : undefined), tint: TINT, run: () => void selectTab(t.id), text: t.url, recent: 0, weight: 9,
        }
      }),
    },
    searchQuery: {
      section: "History",
      // (what's open or bookmarked is listed as that)
      find: async (q) => {
        if (!hasHistory()) return []
        const { rows } = await searchHistory(q, 8)
        const listed = new Set([...webTabs().map((t) => t.url), ...matchBookmarks(getStore()?.bookmarks ?? [], q, 20).map((b) => b.url)])
        return rows.filter((r) => !listed.has(r.url)).slice(0, 5).map((r): SearchDoc => ({
          id: `web-history-${r.url}`, title: r.title || r.host, meta: bare(r.url), kind: "History", icon: siteIcon(r.url), tint: TINT,
          run: () => open(r.url, "typed"), text: r.url, recent: r.last,
        }))
      },
      typed: (q) => {
        if (!webPages) return []
        const t = q.trim(), engine = settings.get().search
        const to = addressOf(t, engine), words = searchUrl(t, engine)
        return [
          ...(to && to !== words ? [{ id: "web-open", title: `Open ${bare(to)}`, meta: "", kind: "Web", icon: siteIcon(to), tint: TINT, run: () => open(to, "typed"), text: "", recent: 0 }] : []),
          ...(http(t) ? [] : [{ id: "web-search", title: `Search the web for "${t}"`, meta: hostOf(searchUrl("", engine)), kind: "Web", icon: Search, tint: TINT,
            run: () => open(words, "typed"), text: "", recent: 0 }]),
        ]
      },
      launcher: () => (webPages ? "Search or enter address…" : null),
    },
  }
}
