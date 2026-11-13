import { Search } from "lucide-react"
import { getStore, getTabLayout, onTabLayoutChange, openWebLink, allPanes, focusedPane, shownTab, selectPane, webPages, type PluginDef, type SearchDoc, type Store } from "@vaultite"
import { addressOf, guessedHttps, hostOf, searchUrl } from "./address"
import { matchBookmarks } from "./bookmarks"
import { colorOf, containerById, containers, destination, keepOutside, splitArg, type Where } from "./containers"
import { guessedFor } from "./drafts"
import { extensionPageName } from "./extstate"
import { hasHistory, markTyped, searchHistory, type Found } from "./history"
import { siteIcon } from "./icons"
import { settings, titleOf } from "./state"

const TINT = "var(--muted-foreground)"
const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
const http = (u: string) => /^https?:\/\//i.test(u)
const completedTo = new Map<string, string>()

function webTabs() {
  if (!webPages) return []
  const l = getTabLayout(), front = shownTab(l)
  return allPanes(l).flatMap((p) => {
    if (!p.to.startsWith("view:web/") || (front && focusedPane(front).id === p.id)) return []
    const { url, container } = splitArg(p.to.slice("view:web/".length))
    return http(url) ? [{ id: p.id, url, container }] : []
  })
}

let asked: { q: string; at: number; answer: Promise<Found> } | null = null
const historyFor = (q: string) => (asked?.q === q && Date.now() - asked.at < 2000 ? asked : (asked = { q, at: Date.now(), answer: searchHistory(q, 8) })).answer

export function switcherSearch(openPage: (url: string, container?: string | null) => void): Pick<PluginDef, "search" | "searchLive" | "searchQuery"> {
  const open = (url: string, how: "typed" | "bookmark", into?: Where) => {
    if (!webPages) return openWebLink(url)
    markTyped(url, how)
    if (into && !into.container) keepOutside(url)
    openPage(url, into?.container)
  }
  return {
    search: (store: Store) => (store.bookmarks ?? []).map((b): SearchDoc => ({
      id: `web-bookmark-${b.url}`, title: b.title || hostOf(b.url), meta: ["Bookmark", ...b.folder.split("/").filter(Boolean), bare(b.url)].join(" · "),
      kind: "Bookmark", icon: siteIcon(b.url), tint: TINT, run: () => open(b.url, "bookmark"), text: `${b.url} ${b.folder}`, recent: 0, weight: 4,
    })),
    searchLive: {
      subscribe: onTabLayoutChange,
      docs: () => webTabs().map((t): SearchDoc => {
        const c = containerById(t.container)
        return {
          id: `web-tab-${t.id}`, title: titleOf(t.url) || extensionPageName(t.url) || hostOf(t.url), meta: ["Switch to tab", c?.name, bare(t.url)].filter(Boolean).join(" · "),
          kind: "Tab", icon: siteIcon(t.url, c ? colorOf(c) : undefined), tint: TINT, run: () => void selectPane(t.id), text: t.url, recent: 0, weight: 9,
        }
      }),
    },
    searchQuery: {
      section: "History",
      find: async (q) => {
        if (!hasHistory()) return []
        const { rows } = await historyFor(q)
        const listed = new Set([...webTabs().map((t) => t.url), ...matchBookmarks(getStore()?.bookmarks ?? [], q, 20).map((b) => b.url)])
        return rows.filter((r) => !listed.has(r.url)).slice(0, 5).map((r): SearchDoc => ({
          id: `web-history-${r.url}`, title: r.title || r.host, meta: bare(r.url), kind: "History", icon: siteIcon(r.url), tint: TINT,
          run: () => open(r.url, "typed"), text: r.url, recent: r.last,
        }))
      },
      complete: async (q) => {
        if (!hasHistory() || /\s/.test(q)) return null
        const { complete } = await historyFor(q)
        if (complete) completedTo.set(complete.text.toLowerCase(), complete.url)
        return complete?.text ?? null
      },
      typed: (q, { complete, turn }) => {
        if (!webPages) return []
        const t = q.trim(), engine = settings.get().search
        const done = complete ? completedTo.get(complete.toLowerCase()) ?? null : null
        const typed = addressOf(t, engine), words = searchUrl(t, engine)
        const to = done ?? (typed && typed !== words ? typed : null)
        const ids = [null, ...containers().map((c) => c.id)]
        const first = destination(to ?? words, { from: null, fresh: true }).container
        const chosen = turn ? ids[(((ids.indexOf(first) + turn) % ids.length) + ids.length) % ids.length] : undefined
        const at = (url: string) => destination(url, { from: null, fresh: true, chosen })
        const tag = (w: Where) => { const c = containerById(w.container); return c ? { label: c.name, color: colorOf(c) } : turn ? { label: "No container", color: "var(--tertiary)" } : undefined }
        const opening = to ? at(to) : null, searching = at(words)
        const guessed = !!to && !done && guessedHttps(t)
        return [
          ...(to && opening ? [{ id: "web-open", title: `Open ${bare(to)}`, meta: "", kind: "Web", icon: siteIcon(to), tint: TINT, tag: tag(opening),
            run: () => { if (guessed) guessedFor(to); open(to, "typed", opening) }, text: "", recent: 0 }] : []),
          ...(http(t) ? [] : [{ id: "web-search", title: `Search the web for "${t}"`, meta: hostOf(searchUrl("", engine)), kind: "Web", icon: Search, tint: TINT,
            tag: tag(searching), run: () => open(words, "typed", searching), text: "", recent: 0 }]),
        ]
      },
      turns: "container",
      owns: (q) => { const engine = settings.get().search, to = addressOf(q, engine); return !!webPages && !!to && to !== searchUrl(q, engine) },
      launcher: () => (webPages ? "Search or enter address…" : null),
    },
  }
}
