import { FileClock, FilePen, History } from "lucide-react"
import {
  changedFiles, cn, definePlugin, menuFor, openFile, openItem, openingSoon, openInSplit, openView, panelMenu, RecentList,
  SidebarHeading, SidebarRow, startDrag, stem, useDrag, useFileIcon, useOpenedFiles, useScopedState, type RecentKind, type SidebarCtx, type Store,
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

function RecentPanel({ store, open, file, panel }: SidebarCtx) {
  const [kind, setKind] = useScopedState<RecentKind>("recent:kind", FIRST)
  const shown = KINDS.find((k) => k.kind === kind) ?? KINDS[0]
  const files = useList(store, shown.kind, 10)
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
        </div>
      )}
    </div>
  )
}

/** The tab (view:recent): both lists, as a blank tab draws them (the sidebar's rows, a size up). */
function RecentView({ store }: { store: Store }) {
  const opened = useList(store, "opened", 12)
  const changed = useList(store, "changed", 20)
  return (
    <div className="flex flex-col gap-3 pb-10" data-recent-view>
      <h1 className="truncate text-[22px] leading-[28px] font-bold max-md:hidden">Recent files</h1>
      <div className="size-up-bleed"><div data-size-up className="flex flex-col gap-3">
        {KINDS.map((k) => {
          const files = k.kind === "opened" ? opened : changed
          return (
            <section key={k.kind} aria-label={k.title}>
              <SidebarHeading title={k.title} open className="mt-0" />
              {files.length ? <RecentList store={store} files={files} /> : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Nothing yet.</p>}
            </section>
          )
        })}
      </div></div>
    </div>
  )
}

export default definePlugin({
  icon: History,
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
