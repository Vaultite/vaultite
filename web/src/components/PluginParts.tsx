import type { ReactNode } from "react"
import { AppWindow, Blocks, Code, FileType, MousePointerClick, PanelLeft, PanelTop, PanelBottom, PencilLine, Slash, SquareMenu, type LucideIcon } from "lucide-react"
import type { Plugin } from "@/core/define"
import { commandKeys, runCommandId } from "@/core/commands"
import { tintOfPlugin } from "@/core/plugins"
import { capitalize, cn } from "@/lib/utils"

type Place = "sidebar" | "header" | "tabs" | "fileBar" | "note" | "status"
type Part = { place: Place; icon: LucideIcon; what: string; names?: string[] }

const words = (id: string) => capitalize(id.replace(/[-_]/g, " "))
const keysOf = <T,>(r: Record<string, T> | undefined) => Object.keys(r ?? {})

export function partsOf(p: Plugin): Part[] {
  const out: Part[] = []
  const add = (on: boolean, part: Part) => { if (on) out.push(part) }
  const panels = Object.values(p.sidebar ?? {}).map((s) => s.title)
  add(!!panels.length, { place: "sidebar", icon: PanelLeft, what: panels.length > 1 ? "Sidebar panels" : "Sidebar panel", names: panels })
  add(!!p.header, { place: "header", icon: PanelTop, what: "In the sidebar's header" })
  add(!!p.views, { place: "tabs", icon: AppWindow, what: "Opens in a tab" })
  add(!!p.fileBar, { place: "fileBar", icon: PanelTop, what: "Above each file" })
  const exts = Object.values(p.formats ?? {}).flatMap((f) => f.exts)
  add(!!exts.length, { place: "tabs", icon: FileType, what: "Opens", names: exts.map((e) => `.${e}`) })
  const blocks = [...keysOf(p.blockDecls), ...keysOf(p.blocks).filter((b) => !(b in (p.blockDecls ?? {})))]
  add(!!blocks.length, { place: "note", icon: Blocks, what: blocks.length > 1 ? "Blocks for notes" : "A block for notes", names: blocks.map(words) })
  add(!!p.fences, { place: "note", icon: Code, what: "Code fences", names: keysOf(p.fences).map((f) => `\`\`\`${f}`) })
  add(!!p.slash, { place: "note", icon: Slash, what: "In the / menu" })
  add(!!(p.editor || p.reading || p.noteTop || p.noteEnd), { place: "note", icon: PencilLine, what: "In your notes" })
  add(!!(p.fileMenu || p.folderMenu || p.viewMenu || p.editorMenu), { place: "note", icon: SquareMenu, what: "In right-click menus" })
  add(!!p.status, { place: "status", icon: PanelBottom, what: "In the status bar" })
  return out
}

const W = 200, H = 124, SHOWN = 4
const ink = (n: number) => `color-mix(in oklab, var(--foreground) ${n}%, transparent)`
const lit = (c: string, n: number) => `color-mix(in oklab, ${c} ${n}%, transparent)`

function Box({ x, y, w, h, on, c, r = 0, children }: { x: number; y: number; w: number; h: number; on: boolean; c: string; r?: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} style={{ fill: on ? lit(c, 22) : "transparent", stroke: on ? c : "none" }} strokeWidth={on ? 1 : 0} />
      {children}
    </g>
  )
}

const Lines = ({ x, y, w, n, c }: { x: number; y: number; w: number; n: number; c: string }) =>
  <>{[0.9, 0.7, 0.82, 0.6, 0.76].slice(0, n).map((f, i) => <rect key={i} x={x} y={y + i * 7} width={w * f} height={3} rx={1.5} style={{ fill: c }} />)}</>

export function PartsSketch({ places, tint }: { places: Set<Place>; tint: string }) {
  const on = (p: Place) => places.has(p)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden data-parts-sketch>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={7} style={{ fill: "var(--background)", stroke: "var(--border)" }} />
      <path d={`M0.5 7.5 a7 7 0 0 1 7 -7 H52 V${H - 0.5} H7.5 a7 7 0 0 1 -7 -7 Z`} style={{ fill: "var(--sidebar)" }} />
      {["var(--red)", "var(--yellow)", "var(--green)"].map((c, i) => <circle key={c} cx={8 + i * 5} cy={7} r={1.6} style={{ fill: c }} />)}
      <Box x={30} y={3} w={19} h={9} r={2} on={on("header")} c={tint}><rect x={34} y={6} width={11} height={3} rx={1.5} style={{ fill: on("header") ? tint : ink(14) }} /></Box>
      <Box x={4} y={18} w={45} h={98} r={3} on={on("sidebar")} c={tint}>
        <Lines x={8} y={24} w={36} n={5} c={on("sidebar") ? lit(tint, 70) : ink(14)} />
        <Lines x={8} y={66} w={30} n={4} c={ink(10)} />
      </Box>
      <Box x={55} y={3} w={W - 58} h={11} r={2} on={on("tabs")} c={tint}>
        <rect x={58} y={5} width={34} height={7} rx={2} style={{ fill: on("tabs") ? lit(tint, 60) : ink(10) }} />
        <rect x={95} y={5} width={28} height={7} rx={2} style={{ fill: ink(6) }} />
      </Box>
      <Box x={55} y={17} w={W - 58} h={9} r={2} on={on("fileBar")} c={tint}>
        <rect x={60} y={20} width={22} height={3} rx={1.5} style={{ fill: ink(16) }} />
        <rect x={W - 16} y={19} width={8} height={5} rx={1.5} style={{ fill: on("fileBar") ? tint : ink(14) }} />
      </Box>
      <Box x={70} y={30} w={W - 100} h={76} r={3} on={on("note")} c={tint}>
        <rect x={76} y={36} width={46} height={5} rx={2} style={{ fill: ink(24) }} />
        <Lines x={76} y={48} w={W - 116} n={3} c={ink(11)} />
        <rect x={76} y={72} width={W - 116} height={26} rx={3} style={{ fill: on("note") ? lit(tint, 35) : ink(5) }} />
      </Box>
      <Box x={55} y={H - 12} w={W - 58} h={9} r={2} on={on("status")} c={tint}>
        <rect x={W - 44} y={H - 9} width={36} height={3} rx={1.5} style={{ fill: on("status") ? tint : ink(14) }} />
      </Box>
    </svg>
  )
}

export function PluginParts({ plugin, on }: { plugin: Plugin; on: boolean }) {
  const parts = partsOf(plugin)
  const commands = (plugin.commands ?? []).filter((c) => !c.when || c.when()).map((c, i) => ({ c, i, keyed: commandKeys(c.id) ? 0 : 1 }))
    .sort((a, b) => a.keyed - b.keyed || a.i - b.i).map((x) => x.c)
  if (!parts.length && !commands.length) return null
  const tint = tintOfPlugin(plugin.id)
  return (
    <div className="mb-6 grid gap-4 rounded-[12px] bg-muted p-4 sm:grid-cols-[minmax(0,14rem)_1fr]" data-plugin-parts={plugin.id}>
      <div className="max-w-[15rem]"><PartsSketch places={new Set(parts.map((x) => x.place))} tint={tint} /></div>
      <div className="min-w-0 space-y-1.5">
        {parts.map((x) => (
          <div key={`${x.place}-${x.what}`} className="flex min-w-0 items-start gap-2 text-[14px] leading-[20px] md:text-[13px]" data-plugin-part={x.place}>
            <x.icon className="mt-0.5 size-4 shrink-0" style={{ color: tint }} strokeWidth={2} />
            <span className="min-w-0">{x.what}{x.names?.length ? <span className="text-muted-foreground">: {x.names.join(", ")}</span> : null}</span>
          </div>
        ))}
        {commands.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1" data-plugin-commands>
            {commands.slice(0, SHOWN).map((c) => {
              const keys = commandKeys(c.id)
              return (
                <button key={c.id} type="button" disabled={!on} onClick={() => runCommandId(c.id)} data-plugin-command={c.id}
                  className={cn("inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-control bg-background px-2 text-[13px] hover:bg-foreground/[0.06] disabled:cursor-default disabled:opacity-60 md:text-[12px]")}>
                  <MousePointerClick className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="truncate">{c.name}</span>
                  {keys && <kbd className="shrink-0 font-sans text-muted-foreground">{keys}</kbd>}
                </button>
              )
            })}
            {commands.length > SHOWN && <span className="self-center text-[12px] text-muted-foreground">and {commands.length - SHOWN} more in the palette</span>}
          </div>
        )}
      </div>
    </div>
  )
}
