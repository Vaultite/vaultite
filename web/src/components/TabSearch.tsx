// Search tabs (⌘⇧A, Chrome's tab search): this window's open tabs, the last focused first, then the ones closed lately
// and the archived ones, to reopen. Enter on the one before shows it again, as ⌘Tab; ⌘⌫ closes the selected tab here.
import { useRef, useState, type KeyboardEvent } from "react"
import { fmtAgo, type Store } from "@/core/data"
import { inVault } from "@/core/files"
import { fuzzy, hasWords } from "@/core/fuzzy"
import { notify } from "@/core/notify"
import { shortcutOf, sameKeys } from "@/core/commands"
import { closedTabs, findOpen, reopenClosed, selectTab, tabsByRecent, useWorkspace } from "@/core/workspace"
import { reopenArchived, useArchivedTabs } from "@/core/tabarchive"
import { closeTabMoving } from "@/core/tabfold"
import { leaves, vaultPath, type Tab, type TabSet } from "../../../core/layout.ts"
import { Marked, Palette } from "@/components/Palette"
import { SetLabel, setName, useTabLabels, type TabInfo } from "@/components/Tabs"
import { Badged } from "@/components/kit"
import { cn } from "@/lib/utils"

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
  /** At its end: "Current tab", "Pinned", its pane, or when it closed. */
  meta?: string
  set?: TabSet
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
  const ws = useWorkspace()
  const archived = useArchivedTabs()
  const info = useTabLabels(store)
  const panes = leaves(ws.root)
  const paneOf = new Map(panes.flatMap((g, n) => g.tabs.map((t) => [t.id, { g, n }] as const)))
  const cur = panes.find((g) => g.id === ws.focus)?.active
  // (a file deleted since isn't offered back, nor what's open again)
  const there = (to: string) => { const p = vaultPath(to); return p === null || inVault(store, p) }
  const away = (to: string) => there(to) && !findOpen(to)

  const open = tabsByRecent().map((t): Row => {
    const { g, n } = paneOf.get(t.id)!, i = info(t), set = t.set ? g.sets?.find((s) => s.id === t.set) : undefined
    const meta = [t.id === cur && "Current tab", t.pinned && "Pinned", panes.length > 1 && `Pane ${n + 1}`].filter(Boolean).join(" · ")
    return { id: `open:${t.id}`, section: OPEN, tab: t, info: i, label: i.label, text: [t.to, set && setName(set)].filter(Boolean).join("\n"),
      host: hostOf(t.to), meta, set, current: t.id === cur, marks: [], pick: () => selectTab(t.id) }
  })
  const seen = new Set<string>()
  const once = (to: string) => !seen.has(to) && !!seen.add(to)
  const closed = closedTabs().filter((c) => away(c.tab.to) && once(c.tab.to)).map((c): Row => {
    const i = info(c.tab)
    return { id: `closed:${c.tab.id}`, section: CLOSED, tab: c.tab, info: i, label: i.label, text: c.tab.to, host: hostOf(c.tab.to),
      meta: c.closed ? fmtAgo(c.closed) : undefined, marks: [], pick: () => reopenClosed(c.tab.id) }
  })
  const kept = archived.filter((e) => away(e.to) && once(e.to)).map((e): Row => {
    const tab = { id: e.id, to: e.to }, i = info(tab)
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
    else if (open.length > 1 || r.tab.to !== "new") closeTabMoving(r.tab.id, document.getElementById(`palette-${r.id}`))
    return true
  }

  return (
    <Palette label="Search tabs" placeholder="Search tabs…" query={q} setQuery={setQ} items={rows} onClose={onClose} onPick={pick} onKey={onKey}
      onSelect={(r) => { selected.current = r?.id ?? null }}
      start={open.length > 1 ? 1 : 0} section={(r) => r.section}
      empty={<p className="px-3 py-6 text-center text-[15px] text-muted-foreground">No tabs match "{query}".</p>}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to open"], [CLOSE, "to close tab"], ["Escape", "to dismiss"]]}
      row={(r) => <TabRow r={r} />} />
  )
}

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
        <span className="min-w-0 shrink truncate text-[15px] leading-[21px] text-foreground/90"><Marked text={r.label} marks={r.marks} /></span>
        {r.host && r.host !== r.label && <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{r.host}</span>}
      </span>
      {r.set && <SetLabel s={{ ...r.set, collapsed: false }} n={0} className="max-w-[40%]" />}
      {r.meta && <span className="shrink-0 text-[13px] text-muted-foreground">{r.meta}</span>}
    </>
  )
}
