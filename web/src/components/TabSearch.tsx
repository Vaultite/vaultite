// Search tabs (⌘⇧A, Chrome's tab search): this window's open tabs, the last focused first, then the ones closed lately
// and the archived ones, to reopen. Enter on the one before shows it again, as ⌘Tab; ⌘⌫ closes the selected tab here.
import { useRef, useState, type KeyboardEvent } from "react"
import { fmtAgo, type Store } from "@/core/data"
import { inVault } from "@/core/files"
import { fuzzy, hasWords } from "@/core/fuzzy"
import { notify } from "@/core/notify"
import { shortcutOf, sameKeys } from "@/core/commands"
import { closedTabs, findOpen, reopenClosed, selectTab, tabsByRecent, useTabList, type ClosedEntry } from "@/core/workspace"
import { reopenArchived, useArchivedTabs } from "@/core/tabarchive"
import { closeTabMoving } from "@/core/tabfold"
import { focusedPane, placesIn, tabOf, vaultPath, type Group, type Tab } from "../../../core/layout.ts"
import { marked, NoMatches, Palette } from "@/components/Palette"
import { GroupLabel, groupName, useTabLabels, type TabInfo } from "@/components/Tabs"
import { Badged } from "@/components/kit"
import { cn, plural } from "@/lib/utils"

const OPEN = "Open tabs", CLOSED = "Recently closed", ARCHIVED = "Archived tabs"
/** Closed and archived tabs listed while nothing is typed: the latest few, as a browser's tab search. */
const FEW = 5
const CLOSE = "Mod+Backspace"

type Row = {
  id: string; section: string; tab: Tab; info: TabInfo; label: string
  /** What else finds it: its address (a file's path, a page's URL) and its group's name. */
  text: string
  /** Muted after the label: a web page's site. */
  host?: string
  /** At its end: "Current tab", "Pinned", or when it closed. */
  meta?: string
  group?: Group
  current?: boolean
  marks: number[]
  pick: () => void
}

const hostOf = (to: string) => {
  const url = /https?:\/\/[^\s/?#]+/i.exec(to)?.[0]
  try { return url ? new URL(url).host.replace(/^www\./, "") : undefined } catch { return undefined }
}

/** Rows matching `q`: by the label (fuzzy, best first), then by their address or group (words as typed, in their order). */
function matching(rows: Row[], q: string): Row[] {
  if (!q) return rows
  const hits = rows.flatMap((r, i) => {
    const m = fuzzy(q, r.label)
    if (m) return [{ r: { ...r, marks: m.marks }, by: 0, score: m.score, i }]
    return hasWords(q, r.text) ? [{ r, by: 1, score: 0, i }] : []
  })
  return hits.sort((a, b) => a.by - b.by || b.score - a.score || a.i - b.i).map((h) => h.r)
}

export function TabSearch({ store, onClose }: { store: Store; onClose: () => void }) {
  const [q, setQ] = useState("")
  const l = useTabList()
  const archived = useArchivedTabs()
  const info = useTabLabels(store)
  const cur = l.active
  /** What else finds a tab: what each of its panes shows. */
  const places = (t: Tab) => placesIn(t).map((p) => p.to)
  // (a file deleted since isn't offered back, nor what's open again)
  const there = (to: string) => { const p = vaultPath(to); return p === null || inVault(store, p) }
  const away = (to: string) => there(to) && !findOpen(to)

  const open = tabsByRecent().map((t): Row => {
    const i = info(t), group = t.group ? l.groups?.find((g) => g.id === t.group) : undefined
    const meta = [t.id === cur && "Current tab", t.pinned && "Pinned"].filter(Boolean).join(" · ")
    return { id: `open:${t.id}`, section: OPEN, tab: t, info: i, label: i.label, text: [...places(t), group && groupName(group)].filter(Boolean).join("\n"),
      host: hostOf(focusedPane(t).to), meta, group, current: t.id === cur, marks: [], pick: () => selectTab(t.id) }
  })
  const seen = new Set<string>()
  const once = (to: string) => !seen.has(to) && !!seen.add(to)
  // (what closed together is one row, reopened together: a tab group, Close others, a window)
  const closed = closedTabs().flatMap((c): Row[] => {
    const tabs = c.tabs.filter((t) => places(t).every(away))
    if (!tabs.length || !once(tabs.flatMap(places).join("\n"))) return []
    const e = { ...c, tabs }, i = info(tabs[0]), group = closedGroup(e)
    return [{ id: `closed:${c.id}`, section: CLOSED, tab: tabs[0], info: i, label: closedName(e, (t) => info(t).label),
      text: [...tabs.flatMap(places), group && groupName(group)].filter(Boolean).join("\n"), host: tabs.length > 1 ? undefined : hostOf(focusedPane(tabs[0]).to), group,
      meta: closedMeta(e), marks: [], pick: () => reopenClosed(c.id, (to) => !there(to)) }]
  })
  const kept = archived.filter((e) => away(e.to) && once(e.to)).map((e): Row => {
    const tab = tabOf(e.to, { id: e.id, pane: e.id }), i = info(tab)
    return { id: `archived:${e.id}`, section: ARCHIVED, tab, info: i, label: e.title || i.label, text: e.to, host: hostOf(e.to),
      meta: fmtAgo(e.archived), marks: [], pick: () => reopenArchived(e.id) }
  })
  const query = q.trim()
  const rows = [...matching(open, query), ...matching(query ? closed : closed.slice(0, FEW), query), ...matching(query ? kept : kept.slice(0, FEW), query)]

  const selected = useRef<string | null>(null)
  const pick = (r: Row | null) => {
    if (!r) return
    onClose()
    setTimeout(r.pick, 0)
  }
  // ⌘⌫: the selected open tab closes as its row folds away (asking first where closing it would, as everywhere).
  const onKey = (e: KeyboardEvent) => {
    if (!sameKeys(shortcutOf(e.nativeEvent), CLOSE)) return false
    const r = rows.find((x) => x.id === selected.current)
    if (r?.section !== OPEN) return false
    e.preventDefault()
    if (r.tab.pinned) notify("Pinned tabs stay open: unpin it to close it", { id: "pinned-stays" })
    else if (open.length > 1 || focusedPane(r.tab).to !== "new") closeTabMoving(r.tab.id, document.getElementById(`palette-${r.id}`))
    return true
  }

  return (
    <Palette label="Search tabs" placeholder="Search tabs…" query={q} setQuery={setQ} items={rows} onClose={onClose} onPick={pick} onKey={onKey}
      onSelect={(r) => { selected.current = r?.id ?? null }}
      start={open.length > 1 ? 1 : 0} section={(r) => r.section}
      empty={<NoMatches what="No tabs match" query={query} />}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to open"], [CLOSE, "to close tab"], ["Escape", "to dismiss"]]}
      row={(r) => <TabRow r={r} />} />
  )
}

/** The tab group a closed entry's tabs were all in, if they were. */
export const closedGroup = (e: ClosedEntry): Group | undefined =>
  e.groups.length === 1 && e.tabs.every((t) => t.group === e.groups[0].id) ? e.groups[0] : undefined
/** A closed entry's name: its tab's, its group's, or its first tab's and how many more ("Lighthouse and 2 more"). */
export function closedName(e: ClosedEntry, label: (t: Tab) => string) {
  const g = closedGroup(e)
  if (e.tabs.length === 1) return label(e.tabs[0])
  return g ? groupName(g) : `${label(e.tabs[0])} and ${e.tabs.length - 1} more`
}
/** What else a closed entry says: a window, how many tabs, when it closed. */
export const closedMeta = (e: ClosedEntry) =>
  [e.window && "Window", e.tabs.length > 1 && plural(e.tabs.length, "tab"), e.closed && fmtAgo(e.closed)].filter(Boolean).join(" · ") || undefined

function TabRow({ r }: { r: Row }) {
  const { info: i } = r
  const Icon = i.icon
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Badged on={i.badge}>
          <Icon className={cn("size-4 shrink-0", i.tint ? undefined : r.current ? "text-primary" : "text-muted-foreground", i.iconClassName)} strokeWidth={2}
            style={i.tint ? { color: i.tint } : undefined} />
        </Badged>
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="min-w-0 shrink truncate text-[15px] leading-[21px] text-foreground/90">{marked(r.label, r.marks)}</span>
        {r.host && r.host !== r.label && <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{r.host}</span>}
      </span>
      {r.group && <GroupLabel g={{ ...r.group, collapsed: false }} className="max-w-[40%]" />}
      {r.meta && <span className="shrink-0 text-[13px] text-muted-foreground">{r.meta}</span>}
    </>
  )
}
