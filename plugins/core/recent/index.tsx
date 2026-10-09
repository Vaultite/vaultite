import { useEffect, useState } from "react"
import { FileClock, FilePen, History } from "lucide-react"
import {
  changedFiles, cn, definePlugin, get, menuFor, openFile, openItem, openingSoon, openInSplit, openView, panelMenu, RecentList,
  SidebarHeading, SidebarRow, startDrag, stem, useDrag, useFileIcon, useOpenedFiles, useScopedState, useVaultChange, type RecentKind, type SidebarCtx, type Store,
} from "@vaultite"

// Recent files: opened lately in this workspace, or changed lately (a toggle kept
// per workspace). The lists are the app's (components/RecentFiles.tsx).
const KINDS: { kind: RecentKind; title: string; icon: typeof FileClock }[] = [
  { kind: "opened", title: "Recently opened", icon: FileClock },
  { kind: "changed", title: "Recently changed", icon: FilePen },
]
const FIRST: RecentKind = "opened"

function useList(store: Store, kind: RecentKind, n: number) {
  const opened = useOpenedFiles(store, n)
  return kind === "opened" ? opened : changedFiles(store, n)
}

/** How many files a list shows at first (the plugin's `limit` setting, 50 as Obsidian's Recent Files plugin). */
const LIMIT = 50
function useLimit() {
  const [n, setN] = useState(LIMIT)
  const read = () => { get<{ limit?: unknown }>("config/plugin/recent").then((s) => { const v = Math.floor(Number(s?.limit)); setN(v >= 1 ? v : LIMIT) }, () => {}) }
  useEffect(read, [])
  useVaultChange(read, (p) => p.startsWith(".vaultite/plugins/recent/"))
  return n
}

/** A list's first `limit` files, then `limit` more at each Show more (one more asked for, to know there are more). */
function useShown(store: Store, kind: RecentKind) {
  const limit = useLimit()
  const [pages, setPages] = useState(1)
  useEffect(() => setPages(1), [kind])
  const files = useList(store, kind, limit * pages + 1)
  const more = files.length > limit * pages
  return { files: more ? files.slice(0, limit * pages) : files, more: more ? () => setPages(pages + 1) : null }
}

function ShowMore({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-keyrow data-recent-more onClick={onClick}
      className="flex h-7 w-full cursor-pointer items-center rounded-[5px] pl-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground max-md:min-h-11 max-md:text-[15px]">
      Show more
    </button>
  )
}

function RecentPanel({ store, open, file, panel }: SidebarCtx) {
  const [kind, setKind] = useScopedState<RecentKind>("recent:kind", FIRST)
  const shown = KINDS.find((k) => k.kind === kind) ?? KINDS[0]
  const { files, more } = useShown(store, shown.kind)
  const iconOf = useFileIcon(store)
  const d = useDrag()
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-recent-panel={shown.kind}>
      <SidebarHeading title={shown.title} open={open}>
        {KINDS.map((k) => (
          <button key={k.kind} type="button" onClick={() => setKind(k.kind === FIRST ? undefined : k.kind)} data-tip={k.title} aria-label={k.title}
            aria-pressed={k.kind === shown.kind}
            className={cn("grid size-6 cursor-pointer place-items-center rounded-[4px] hover:bg-foreground/[0.06] hover:text-foreground",
              k.kind === shown.kind ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground")}>
            <k.icon className="size-[15px]" strokeWidth={2} />
          </button>
        ))}
      </SidebarHeading>
      {!files.length ? (
        <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">{shown.kind === "opened" ? "Nothing opened yet" : "Nothing changed yet"}</p>
      ) : (
        <div className="flex flex-col gap-px" data-keylist>
          {files.map((p) => {
            const { icon, tint } = iconOf(p)
            return (
              <div key={p} onPointerDown={(e) => { openingSoon(p, true); startDrag(e, { from: "row", to: `file:${p}`, path: p, label: stem(p) }) }}
                onPointerEnter={() => openingSoon(p)} onPointerLeave={() => openingSoon(null)}
                onContextMenu={menuFor(() => [
                  openItem(() => openFile(p, { newTab: true }), () => openInSplit(`file:${p}`, "right")),
                  ...(panel ? panelMenu(panel).map((it, i) => (i ? it : { ...it, sep: true })) : []),
                ])}
                className={cn(d?.item.from === "row" && d.item.path === p && "opacity-40")}>
                <SidebarRow data-recent={p} href={`#file/${encodeURIComponent(p)}`} icon={icon} tint={tint} label={stem(p)} open={open} active={p === file}
                  onClick={(e) => openFile(p, { newTab: e.metaKey || e.ctrlKey || e.button === 1 })} />
              </div>
            )
          })}
          {more && <ShowMore onClick={more} />}
        </div>
      )}
    </div>
  )
}

/** The tab (view:recent): both lists, as a blank tab draws them (the sidebar's rows, a size up). */
function RecentView({ store }: { store: Store }) {
  const opened = useShown(store, "opened")
  const changed = useShown(store, "changed")
  return (
    <div className="flex flex-col gap-3 pb-10" data-recent-view>
      <h1 className="truncate text-[22px] leading-[28px] font-bold max-md:hidden">Recent files</h1>
      <div className="size-up-bleed"><div data-size-up className="flex flex-col gap-3">
        {KINDS.map((k) => {
          const { files, more } = k.kind === "opened" ? opened : changed
          return (
            <section key={k.kind} aria-label={k.title}>
              <SidebarHeading title={k.title} open className="mt-0" />
              {files.length ? <RecentList store={store} files={files} /> : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Nothing yet.</p>}
              {more && <ShowMore onClick={more} />}
            </section>
          )
        })}
      </div></div>
    </div>
  )
}

export default definePlugin({
  sidebar: {
    recent: {
      title: "Recent files", names: ["recent", "recently opened", "recently changed", "recently edited"], heading: false, sort: 37, hidden: true,
      view: "recent", flyout: { icon: History }, render: (ctx) => <RecentPanel {...ctx} />,
    },
  },
  views: { recent: { icon: History, title: () => "Recent files", render: ({ store }) => <RecentView store={store} /> } },
  commands: [
    { id: "recent:open-tab", name: "Open recent files in a tab", run: () => openView("recent", { newTab: true }) },
  ],
})
