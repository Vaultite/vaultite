// Graph view: the whole vault, a file's local graph (a tab or the sidebar panel), and
// ```block-graph for a file's neighbours.
import { SquareArrowOutUpRight, Waypoints } from "lucide-react"
import { currentFile, definePlugin, isViewOpen, notify, openView, Panel } from "@vaultite"
import { FollowingGraph, GraphView, LocalGraph, LocalGraphPanel } from "./GraphView"
import { nameOf } from "./graph"

const openLocal = (path?: string | null) => {
  if (!path) return notify("Open a file to see its local graph")
  openView(`graph/${path}`, { newTab: true })
}

// A made-up graph for the Plugins sheet.
const MOCK = {
  nodes: [
    ["Notes/Lighthouse ideas.md", "Notes", 4], ["Projects/Lighthouse.md", "Projects", 3], ["People/Alice Park.md", "People", 2],
    ["People/Bob Lee.md", "People", 2], ["Notes/Reading list.md", "Notes", 1], ["Books/Project Hail Mary.md", "Books", 1],
    ["Notes/Weekly review.md", "Notes", 1],
  ].map(([path, folder, degree]) => ({ path, title: nameOf(String(path)), type: null, folder, tags: [], degree })),
  edges: [
    ["Notes/Lighthouse ideas.md", "Projects/Lighthouse.md"], ["Notes/Lighthouse ideas.md", "People/Alice Park.md"],
    ["Notes/Lighthouse ideas.md", "People/Bob Lee.md"], ["Projects/Lighthouse.md", "People/Bob Lee.md"],
    ["Notes/Lighthouse ideas.md", "Notes/Weekly review.md"], ["Notes/Reading list.md", "Books/Project Hail Mary.md"],
    ["Projects/Lighthouse.md", "People/Alice Park.md"],
  ].map(([from, to]) => ({ from, to })),
}

export default definePlugin({
  icon: Waypoints,
  views: {
    graph: {
      icon: Waypoints, full: true,
      title: (arg) => (arg ? `Graph of ${nameOf(arg)}` : "Graph view"),
      render: ({ arg }) => <GraphView key={arg} arg={arg} />,
    },
    // The sidebar's Local graph panel as a tab: it follows the file you're on (graph/<path> stays on one file).
    "local-graph": { icon: Waypoints, full: true, title: () => "Local graph", render: () => <FollowingGraph /> },
  },
  commands: [
    { id: "graph:open", name: "Open graph view", keys: ["Mod+G"], run: () => openView("graph", { newTab: !isViewOpen("graph") }) },
    { id: "graph:local", name: "Open local graph", run: () => openLocal(currentFile()) },
  ],
  // Not in the sidebar until shown from its right-click menu (`hidden`).
  sidebar: {
    local: { title: "Local graph", heading: false, sort: 45, tall: true, hidden: true, view: "local-graph", flyout: { icon: Waypoints, width: 320 },
      render: (ctx) => <LocalGraphPanel {...ctx} /> },
  },
  fileMenu: (path) => [{ label: "Open local graph", icon: Waypoints, section: "more", run: () => openLocal(path) }],
  blocks: {
    graph: ({ path, options }) => {
      const depth = Math.max(1, Math.min(3, Number(options.depth) || 1))
      const height = Math.max(160, Math.min(800, Number(options.height) || 300))
      return (
        <Panel title={typeof options.title === "string" ? options.title : "Graph"} icon={Waypoints} tint="var(--purple)"
          action={<button type="button" onClick={() => openLocal(path)} aria-label="Open in a tab" data-tip="Open in a tab"
            className="grid size-6 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
            <SquareArrowOutUpRight className="size-3.5" strokeWidth={2.25} /></button>}>
          <div className="-mx-4 -mb-4 overflow-hidden rounded-b-[12px]"><LocalGraph path={path} depth={depth} height={height} /></div>
        </Panel>
      )
    },
  },
  mockLive: () => ({ graph: MOCK, "graph/settings": {} }),
  preview: () => (
    <div className="relative h-[240px] overflow-hidden rounded-[12px] border-[0.5px] border-border">
      <LocalGraph path="Notes/Lighthouse ideas.md" height={240} />
    </div>
  ),
})
