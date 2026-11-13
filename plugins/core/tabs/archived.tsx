import { useEffect, useMemo, useRef } from "react"
import { ArchiveRestore, Trash2 } from "lucide-react"
import {
  archivedTabs, archiveUnseen, Button, Empty, fmtAgo, getStore, menuFor, notify, openPluginSettings, plural, removals, removeArchived, reopenArchived,
  restoreArchived, retargetArchived, rowMenu, selectClick, selectedAttr, setArchiveAfter, SidebarRow, subscribeScoped, tabLabel, touchTabsSeen, useArchivedTabs,
  useSelectable, useSelected, useTabLabels, type ArchivedTab, type MenuItem, type SearchDoc, type Store, type TabInfo,
} from "@vaultite"
import { settings } from "./settings"

const HOUR = 3600_000
const AFTER: Record<string, number> = { never: 0, "12h": 12 * HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR }
const WORDS: Record<string, string> = { "12h": "12 hours", "24h": "24 hours", "7d": "7 days", "30d": "30 days" }
const afterNow = (v: unknown) => AFTER[String(v)] ?? 0

export function Archiver({ store }: { store: Store }) {
  const set = settings.use(true), after = set ? afterNow(set.archive_after) : null
  const info = useTabLabels(store)
  const infoRef = useRef(info)
  useEffect(() => { infoRef.current = info })
  useEffect(() => { if (after !== null) setArchiveAfter(after) }, [after])
  useEffect(() => {
    if (!after) return
    let ready = false
    const sweep = () => {
      touchTabsSeen()
      if (!ready || document.visibilityState !== "visible") return
      const gone = archiveUnseen((t) => infoRef.current(t).label)
      if (gone.length) notify(`Archived ${plural(gone.length, "tab")} you hadn't looked at in ${WORDS[String(settings.get().archive_after)] ?? "a while"}`,
        { action: { label: "Undo", run: () => { for (const e of gone) reopenArchived(e.id, false) } } })
    }
    const first = window.setTimeout(() => { ready = true; sweep() }, 60_000)
    const every = window.setInterval(sweep, 5 * 60_000)
    document.addEventListener("visibilitychange", sweep)
    return () => { clearTimeout(first); clearInterval(every); document.removeEventListener("visibilitychange", sweep) }
  }, [after])
  return null
}

export const archivedSearch = {
  subscribe: subscribeScoped,
  docs: (): SearchDoc[] => archivedTabs().filter((e) => !e.to.startsWith("file:")).map((e) => {
    const i = tabLabel({ id: e.id, to: e.to }, getStore())
    return { id: `archived-tab-${e.id}`, title: e.title || i.label, kind: "Archived tab", icon: i.icon, tint: i.tint ?? "var(--muted-foreground)",
      meta: `Archived ${fmtAgo(e.archived)}`, text: e.to.replace(/^view:/, ""), recent: e.archived, archived: true, run: () => reopenArchived(e.id) }
  }),
}

export const archivedAnswer = () => ({ archived: archivedTabs().map(({ id, to, title, archived }) => ({ id, to, title, archived: new Date(archived).toISOString() })) })
export const followMove = (from: string, to: string | null) => { if (to !== null) retargetArchived(from, to) }

const LIST = "tabs:archived"
const removing = removals()
function remove(entries: ArchivedTab[]) {
  const keys = entries.map((e) => e.id)
  void removing.remove(keys, async () => removeArchived(keys), "Couldn't remove them").then((ok) => {
    if (ok) notify(`Removed ${plural(entries.length, "archived tab")}`, { action: { label: "Undo", run: () => { removing.back(keys); restoreArchived(entries) } } })
  })
}

export function ArchivedView({ store }: { store: Store }) {
  const all = useArchivedTabs()
  const info = useTabLabels(store)
  const files = useMemo(() => new Set(store.files.files.map((f) => f.path)), [store.files])
  const shown = useMemo(() => all.filter((e) => !e.to.startsWith("file:") || files.has(e.to.slice(5))), [all, files])
  const { list, leaving } = removing.use(shown, (e) => e.id)
  const byId = useMemo(() => new Map(shown.map((e) => [e.id, e])), [shown])
  useSelectable(LIST, { noun: ["tab", "tabs"], menu: (ids) => {
    const picked = ids.flatMap((id) => byId.get(id) ?? [])
    return [
      { label: `Reopen ${plural(picked.length, "tab")}`, icon: ArchiveRestore, run: () => { for (const e of picked) reopenArchived(e.id) } },
      { label: "Remove", icon: Trash2, danger: true, sep: true, run: () => remove(picked) },
    ]
  } })
  const after = String(settings.use().archive_after ?? "never")
  return (
    <div className="flex flex-col gap-3 pb-10" data-archived-tabs>
      <h1 className="truncate text-[22px] leading-[28px] font-bold max-md:hidden">Archived tabs</h1>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <p className="min-w-0 flex-1">{WORDS[after] ? `Unpinned tabs you haven't looked at in ${WORDS[after]} are archived here.` : "Tabs don't archive themselves: Archive tabs is Never."}</p>
        <Button look="quiet" size="small" onClick={() => openPluginSettings("tabs")}>Settings…</Button>
        {!!list?.length && <Button look="quiet" size="small" onClick={() => remove(list)} data-archived-clear>Remove all</Button>}
      </div>
      {!list?.length ? <Empty>No archived tabs.</Empty> : (
        <div className="size-up-bleed"><div data-size-up data-keylist data-select-list={LIST} className="flex flex-col gap-px">
          {list.map((e) => <ArchivedRow key={e.id} e={e} i={info({ id: e.id, to: e.to })} leaving={leaving(e.id)} />)}
        </div></div>
      )}
    </div>
  )
}

function ArchivedRow({ e, i, leaving }: { e: ArchivedTab; i: TabInfo; leaving?: "" }) {
  const picked = useSelected(LIST, e.id)
  const own = (): MenuItem[] => [
    { label: "Reopen", icon: ArchiveRestore, run: () => reopenArchived(e.id) },
    { label: "Remove", icon: Trash2, danger: true, sep: true, run: () => remove([e]) },
  ]
  return (
    <SidebarRow icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} label={e.title || i.label} open more data-archived-tab={e.id} data-select-key={e.id}
      data-leaving={leaving} {...selectedAttr(picked)}
      swipe={() => [{ label: "Remove", icon: Trash2, danger: true, run: () => remove([e]), removes: true }]}
      onClick={(ev) => { if (!selectClick(ev, LIST, e.id)) reopenArchived(e.id) }}
      onContextMenu={menuFor(rowMenu(LIST, e.id, own))}>
      <span className="mr-1 shrink-0 text-[12px] text-tertiary tabular-nums">{fmtAgo(e.archived, { short: true })}</span>
    </SidebarRow>
  )
}
