// Mind map: a note's headings drawn as a map, in a tab (view:mind-map/<path>, or following the file you're on) and as
// a block. The headings are the editor's text as it's typed (useOutline), so the map keeps up.
import { useMemo } from "react"
import { Network, SquareArrowOutUpRight } from "lucide-react"
import { currentFile, definePlugin, notify, openFile, openView, Panel, stem, useFocusedFile, useOutline } from "@vaultite"
import { MindMap } from "./MindMap"
import { treeOf } from "./tree"

const TINT = "var(--mind-map)"

const openMap = (path?: string | null, split = false) => {
  if (!path || !/\.md$/i.test(path)) return notify("Open a note to see its mind map")
  openView(`mind-map/${path}`, split ? { split: true } : { newTab: true })
}

/** The map of `path`'s headings; a click goes to that heading (the root: the note). */
function NoteMap({ path, depth, height }: { path: string; depth?: number; height?: number }) {
  const { headings, loading, go } = useOutline(path)
  const root = useMemo(() => treeOf(headings, stem(path)), [headings, path])
  if (loading) return <div style={{ height: height ?? 120 }} aria-busy />
  if (!headings.length) return <p className="py-3 text-[15px] text-muted-foreground">No headings in {stem(path)} yet: its headings are the map's branches.</p>
  return <MindMap root={root} path={path} depth={depth} height={height}
    onGo={(line) => { const h = headings.find((x) => x.line === line); if (h) go(h); else openFile(path) }} />
}

function MapView({ arg }: { arg?: string }) {
  const focused = useFocusedFile()
  const path = arg || focused.path
  if (!path || !/\.md$/i.test(path)) return <p className="p-4 text-[15px] text-muted-foreground">Open a note to see its headings as a mind map.</p>
  return (
    <div className="pb-10" data-mind-map-view>
      <h1 className="mb-1 truncate text-[22px] leading-[28px] font-bold max-md:hidden">{stem(path)}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">Its headings as a map: click one to go there, fold a branch with its dot.</p>
      <NoteMap path={path} />
    </div>
  )
}

const MOCK = treeOf([
  { level: 1, text: "Goals", line: 1 }, { level: 2, text: "Ship the beta", line: 2 }, { level: 2, text: "Hire a designer", line: 3 },
  { level: 1, text: "Risks", line: 4 }, { level: 2, text: "Timeline", line: 5 }, { level: 1, text: "Notes", line: 6 },
], "Lighthouse plan")

export default definePlugin({
  views: {
    "mind-map": { icon: Network, title: (arg) => (arg ? `Mind map of ${stem(arg)}` : "Mind map"), render: ({ arg }) => <MapView key={arg} arg={arg} /> },
  },
  commands: [
    { id: "mind-map:open", name: "Open mind map", run: () => openMap(currentFile()) },
    { id: "mind-map:open-split", desktop: true, name: "Open mind map in right split", run: () => openMap(currentFile(), true) },
  ],
  fileMenu: (path) => (/\.md$/i.test(path) ? [{ label: "Open mind map", icon: Network, section: "more", run: () => openMap(path) }] : []),
  blocks: {
    "mind-map": ({ path, options }) => {
      const depth = Math.max(1, Math.min(6, Number(options.depth) || 6))
      const height = Math.max(160, Math.min(900, Number(options.height) || 360))
      return (
        <Panel title="Mind map" icon={Network} tint={TINT}
          action={<button type="button" onClick={() => openMap(path)} aria-label="Open in a tab" data-tip="Open in a tab"
            className="grid size-6 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
            <SquareArrowOutUpRight className="size-3.5" strokeWidth={2.25} /></button>}>
          <div className="-mx-4 -mb-4"><NoteMap path={path} depth={depth} height={height} /></div>
        </Panel>
      )
    },
  },
  preview: () => (
    <Panel title="Mind map" icon={Network} tint={TINT}>
      <div className="-mx-4 -mb-4"><MindMap root={MOCK} path="" onGo={() => {}} height={200} /></div>
    </Panel>
  ),
})
