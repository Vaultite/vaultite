import { ListTree } from "lucide-react"
import { cn, definePlugin, openView, SidebarHeading, stem, useFocusedFile, useOutline, type SidebarCtx } from "@vaultite"

// Outline: the focused file's headings, following scrolling and typing (the editor's text, not the
// saved file: core/anchors.ts). A hidden sidebar panel and a tab.

/** A heading as it reads: links by their text, without Markdown's marks. */
const plain = (t: string) => t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`=]/g, "") || "Untitled"

function OutlineList({ path }: { path: string }) {
  const md = /\.md$/i.test(path)
  const { headings, current, go } = useOutline(md ? path : "")
  const top = headings.length ? Math.min(...headings.map((h) => h.level)) : 1
  if (!headings.length) {
    return <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">{md ? "No headings in this file." : "Open a note to see its headings."}</p>
  }
  return (
    <div role="list" data-keylist>
      {headings.map((h, i) => (
        <button key={`${h.line}:${h.text}`} type="button" role="listitem" data-keyrow onClick={() => go(h)} data-outline-item={h.text} data-tip={plain(h.text)} data-tip-trunc
          aria-current={i === current ? "location" : undefined}
          className={cn("flex h-7 w-full min-w-0 cursor-pointer items-center rounded-[5px] pr-1 text-left text-[13px] hover:bg-foreground/[0.04]",
            i === current ? "bg-foreground/[0.08] font-medium text-foreground" : "text-muted-foreground")}
          style={{ paddingLeft: `calc(${h.level - top} * 14px + 6px)` }}>
          <span className="truncate">{plain(h.text)}</span>
        </button>
      ))}
    </div>
  )
}

function OutlinePanel({ open, file: focused }: SidebarCtx) {
  const last = useFocusedFile()
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-outline-panel>
      <SidebarHeading title="Outline" open={open} />
      <OutlineList path={focused || last.path} />
    </div>
  )
}

/** The tab (view:outline): the headings of the file in the pane focused last. */
function OutlineView() {
  const { path } = useFocusedFile()
  return (
    <div className="pb-10" data-outline-view>
      <h1 className="mb-1 truncate text-[22px] leading-[28px] font-bold max-md:hidden">{path ? stem(path) : "Outline"}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">Its headings: click one to go there. Follows the file you're on.</p>
      {/* The panel's list, a size up (`data-size-up`). */}
      <div className="size-up-bleed"><div data-size-up><OutlineList path={path} /></div></div>
    </div>
  )
}

export default definePlugin({
  sidebar: { outline: { title: "Outline", heading: false, sort: 46, hidden: true, view: "outline", flyout: { icon: ListTree }, render: (ctx) => <OutlinePanel {...ctx} /> } },
  views: { outline: { icon: ListTree, title: () => "Outline", render: () => <OutlineView /> } },
  commands: [
    { id: "outline:open-tab", name: "Open outline in a tab", run: () => openView("outline", { newTab: true }) },
    { id: "outline:open-split", desktop: true, name: "Open outline in right split", run: () => openView("outline", { split: true }) },
  ],
})
