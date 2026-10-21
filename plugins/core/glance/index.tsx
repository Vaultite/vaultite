// Glance: ⌥-click (Alt-click off a Mac) a link, a file in the tree or a search result, and it opens over the page in a
// wide sheet, live; from there it becomes a tab or goes to the side. A listener on the whole page, as Page preview's.
import { useEffect, useRef } from "react"
import { Columns2, SquareArrowOutUpRight, type LucideIcon } from "lucide-react"
import {
  afterSheets, backDetail, definePlugin, detailPath, getStore, linkPlace, openAt, openDetail, openInSplit, openView, SheetActions, showAnchorIn, stem,
  TargetView, viewInfo, viewShown, webPages, type Store,
} from "@vaultite"

/** What a click on `el` glances at, as the sheet's path (`glance/<tab target>[/<heading>]`), or null: not something to glance at. */
function glanceOf(s: Store, el: Element): string | null {
  if (el.closest("input, textarea, select, [data-canvas-node], [data-no-glance]")) return null
  const at = el.closest<HTMLElement>("[data-wiki], [data-url], a[href], [data-preview], [data-tree-path]:not([data-tree-folder])")
  if (!at) return null
  const d = at.dataset
  if (d.treePath) return detailPath("glance", `file:${d.treePath}`)
  if (d.preview) return detailPath("glance", `file:${d.preview}`)
  const from = at.closest<HTMLElement>("[data-preview-path]")?.dataset.previewPath ?? at.closest<HTMLElement>("[data-embed]")?.dataset.embed
    ?? at.closest<HTMLElement>(".file-view[data-path]")?.dataset.path ?? at.closest<HTMLElement>("[data-markdown-from]")?.dataset.markdownFrom
  const url = d.url ?? (at instanceof HTMLAnchorElement && at.origin !== location.origin ? at.href : undefined)
  const place = d.wiki ? linkPlace(s, { wiki: d.wiki }, from) : url ? linkPlace(s, { url }, from) : null
  if (place?.file) return detailPath("glance", `file:${place.file}`, ...(place.anchor ? [place.anchor] : []))
  // (a web page only where the Web viewer can show one: the desktop app)
  if (place?.url && webPages && viewShown(`view:web/${place.url}`)) return detailPath("glance", `view:web/${place.url}`)
  return null
}

function Clicks() {
  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return
    const hit = (e: MouseEvent) => {
      const s = getStore()
      if (e.button !== 0 || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || !s || !(e.target instanceof Element)) return null
      return glanceOf(s, e.target)
    }
    // The press too: the editor follows a link on it, and would move its cursor into this one.
    const down = (e: MouseEvent) => { if (hit(e)) { e.preventDefault(); e.stopPropagation() } }
    const click = (e: MouseEvent) => {
      const to = hit(e)
      if (!to) return
      e.preventDefault()
      e.stopPropagation()
      openDetail(to)
    }
    document.addEventListener("mousedown", down, true)
    document.addEventListener("click", click, true)
    return () => {
      document.removeEventListener("mousedown", down, true)
      document.removeEventListener("click", click, true)
    }
  }, [])
  return null
}

/** Keep what's glanced at: in a new tab of the focused pane, or in the pane beside it. */
function keep(to: string, anchor: string, side: boolean) {
  afterSheets(() => {
    const file = to.startsWith("file:") ? to.slice(5) : null
    if (side) {
      openInSplit(to, "right")
      if (file && anchor) openAt(file, anchor)
    } else if (file) openAt(file, anchor, { newTab: true })
    else openView(to, { newTab: true })
  })
}

function Action({ icon: Icon, label, run }: { icon: LucideIcon; label: string; run: () => void }) {
  return (
    <button type="button" onClick={run}
      className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
      <Icon className="size-4" strokeWidth={2} />
      {label}
    </button>
  )
}

function Glance({ store, to, anchor }: { store: Store; to: string; anchor: string }) {
  const box = useRef<HTMLDivElement>(null)
  // Where it is now: a web page that followed a link changed its address, not the sheet's (that would load it again).
  const now = useRef(to)
  const file = to.startsWith("file:") ? to.slice(5) : null
  useEffect(() => { if (file && anchor && box.current) showAnchorIn(box.current, file, anchor) }, [file, anchor])
  return (
    <div ref={box} className="contents">
      <SheetActions>
        <Action icon={SquareArrowOutUpRight} label="Open in tab" run={() => keep(now.current, anchor, false)} />
        <Action icon={Columns2} label="Open to the side" run={() => keep(now.current, anchor, true)} />
      </SheetActions>
      <TargetView store={store} to={to} close={backDetail} setTarget={(t) => { now.current = t }} />
    </div>
  )
}

export default definePlugin({
  details: {
    glance: {
      wide: true,
      title: (_, [to]) => (to?.startsWith("file:") ? stem(to.slice(5)) : to ? viewInfo(to).label : "") || "Glance",
      render: (store, [to, anchor]) => <Glance store={store} to={to ?? ""} anchor={anchor ?? ""} />,
    },
  },
  background: () => <Clicks />,
})
