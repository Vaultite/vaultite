// Bundles: setups to start from, save and share (format: core/bundles.ts); a card, or a bundle pasted or dropped on the
// page, opens a preview of what applying it changes, asking first when it runs code.
import { official } from "../../../core/updates.ts"
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import {
  ArrowRight, Bot, Copy, Download, FilePlus, History, Import, LayoutDashboard, MoreHorizontal, Package, PanelLeft, PanelRight, Pin, Plus,
  Puzzle, RefreshCw, Settings2, Share, ShieldAlert, Trash2, type LucideIcon,
} from "lucide-react"
import type { Store } from "@/core/data"
import { fmtAgo } from "@/core/data"
import {
  addIncoming, agentPrompt, applyBundle, bundleText, deleteBundle, exportBundle, givenImport, importText, incomingOf, isBundleText, openImport, previewOf,
  refreshBundles, restoreSetup, runsCode, saveBundle, shareOf, skipOnboarding, startSave, takenShot, useBundles, usePicture, type BundleInfo, type Incoming,
  type Plan, type ShareItem,
} from "@/core/bundles"
import { copyText } from "@/core/richmd"
import { closeDetail, openDetail, replaceDetail } from "@/core/nav"
import { errorText, notify, notifyError } from "@/core/notify"
import { namedIcon, tintOf } from "@/core/pages"
import { PLUGINS, pluginById, switchedOn, tintOfPlugin, usePlugins } from "@/core/plugins"
import { currentWorkspace } from "@/core/scope"
import { usePrefs } from "@/core/prefs"
import { menuBelow } from "@/components/ContextMenu"
import { confirmDialog } from "@/components/ConfirmDialog"
import { useSheetGuard } from "@/components/DetailSheet"
import { Bar as Line, PageHeader, Panel, SheetHead, Switch } from "@/components/kit"
import { Swatches } from "@/components/Appearance"
import { cn } from "@/lib/utils"
import { Button } from "@/components/Button"
import { BundleLink } from "./BundleLink"

const stem = (p: string) => p.split("/").pop()!.replace(/\.(md|base|canvas|html|csv)$/, "")
const iconOfBundle = (b: Pick<BundleInfo, "icon">) => namedIcon(b.icon) ?? Package
const tintOfBundle = (b: Pick<BundleInfo, "tint">) => tintOf(b.tint) ?? "var(--primary)"

// ---------- a bundle's card picture ----------
// Drawn from what the bundle sets (its panels, its first pinned page's blocks), a sketch rather than every detail.

const PALETTE = ["var(--primary)", "var(--green)", "var(--orange)", "var(--blue)", "var(--purple)", "var(--teal)"]
const faint = "bg-foreground/[0.1]"
const Bar = ({ w, className, style }: { w: string; className?: string; style?: CSSProperties }) =>
  <span className={cn("block h-[4px] shrink-0 rounded-full", className ?? faint)} style={{ width: w, ...style }} />
const Square = ({ c }: { c: string }) => <span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: c }} />
const dim = "color-mix(in oklab, var(--foreground) 22%, transparent)"

/** One sidebar panel, small: what it looks like at a glance. */
function MiniPanel({ k, b, folded, narrow }: { k: string; b: BundleInfo; folded: boolean; narrow?: boolean }) {
  const kind = k.split(":")[0]
  const head = <div className="flex h-[7px] items-center gap-1"><span className="size-0 border-y-[2.5px] border-l-[3.5px] border-y-transparent border-l-foreground/30" /><Bar w="40%" className="bg-foreground/[0.16]" /></div>
  if (kind === "search") return <div className="h-[9px] w-full shrink-0 rounded-[3px] bg-foreground/[0.07]" />
  if (kind === "pages") {
    const pins = (b.pinned ?? ["", "", ""]).slice(0, 3)
    if (!pins.length) return null
    return (
      <div className="flex flex-col gap-[4px]">
        {pins.map((p, i) => (
          <div key={i} className="flex h-[10px] items-center gap-1.5">
            <Square c={i === 0 ? tintOfBundle(b) : dim} />
            {p ? <span className="truncate text-[8.5px] leading-none font-medium text-foreground/75">{stem(p)}</span> : <Bar w="70%" />}
          </div>
        ))}
      </div>
    )
  }
  if (folded) return head
  if (kind === "files") return (
    <div className="flex flex-col gap-[5px]">
      {[[0, "55%", 1], [1, "60%"], [1, "48%", 2], [1, "66%"], [0, "45%", 1], [0, "52%", 1]].map(([depth, w, folder], i) => (
        <div key={i} className={cn("flex h-[6px] items-center gap-1", i === 2 && "-mx-1 rounded-[2px] px-1 py-[5px]")}
          style={{ paddingLeft: depth ? 9 : undefined, background: i === 2 ? "color-mix(in oklab, var(--foreground) 8%, transparent)" : undefined }}>
          {folder === 1 && <span className="size-0 border-y-[2.5px] border-l-[3.5px] border-y-transparent border-l-foreground/30" />}
          <Bar w={w as string} className={folder === 1 ? "bg-foreground/[0.16]" : faint} />
        </div>
      ))}
    </div>
  )
  if (kind === "terminal") return (
    <div className="flex flex-col gap-[5px]">
      {["62%", "48%"].map((w, i) => <div key={i} className="flex h-[6px] items-center gap-1.5"><span className="size-[5px] shrink-0 rounded-full" style={{ background: i ? dim : "var(--green)" }} /><Bar w={w} /></div>)}
    </div>
  )
  if (kind === "outline") return (
    <div className="flex flex-col gap-[5px]">{head}{[[0, "80%"], [6, "60%"], [6, "70%"], [0, "55%"]].map(([pad, w], i) => <div key={i} style={{ paddingLeft: pad as number }}><Bar w={w as string} /></div>)}</div>
  )
  return (
    <div className="flex flex-col gap-[5px]">
      {head}
      {(narrow ? ["85%", "65%"] : ["70%", "55%"]).map((w, i) => <div key={i} className="flex h-[6px] items-center gap-1.5"><span className="size-[5px] shrink-0 rounded-full" style={{ background: kind === "inbox" && !i ? "var(--blue)" : dim }} /><Bar w={w} /></div>)}
    </div>
  )
}

type Shape = "board" | "table" | "cards" | "calendar" | "meter" | "list" | "check" | "tiles" | "card"
const shapeOf = ({ block, view }: { block: string; view: string | null }): Shape =>
  block === "base" ? (view === "board" || view === "cards" || view === "calendar" ? view : "table")
  : /limits|usage|stats|perf|sleep|nutrition|goals|summary/.test(block) ? "meter"
  : /routines/.test(block) ? "check"
  : /machines|people-map/.test(block) ? "tiles"
  : /sessions|inbox|activity|agenda|due|wants|log|projects|books|people/.test(block) ? "list"
  : "card"

/** A block, small, by its shape. */
function MiniBlock({ shape, c }: { shape: Shape; c: string }) {
  const body = (() => {
    switch (shape) {
      case "board": return (
        <div className="grid flex-1 grid-cols-3 gap-1">
          {[2, 1, 2].map((n, i) => <div key={i} className="flex flex-col gap-[3px] rounded-[3px] bg-foreground/[0.04] p-[3px]">{Array.from({ length: n }, (_, j) => <span key={j} className="h-[5px] rounded-[2px] bg-card shadow-[0_0_0_0.5px_var(--border)]" style={i + j === 0 ? { background: c } : undefined} />)}</div>)}
        </div>
      )
      case "table": return (
        <div className="flex flex-col">
          {["", "", ""].map((_, i) => <div key={i} className={cn("flex h-[7px] items-center gap-1.5", i && "border-t-[0.5px] border-border")}><Bar w="34%" style={i ? undefined : { background: c }} /><Bar w="22%" /><Bar w="18%" /></div>)}
        </div>
      )
      case "cards": return <div className="grid flex-1 grid-cols-3 gap-1">{[0, 1, 2].map((i) => <span key={i} className="rounded-[3px] bg-foreground/[0.06]" style={i ? undefined : { background: `color-mix(in oklab, ${c} 45%, transparent)` }} />)}</div>
      case "calendar": return <div className="grid grid-cols-7 gap-[2px]">{Array.from({ length: 14 }, (_, i) => <span key={i} className="h-[5px] rounded-[1.5px]" style={{ background: i === 9 ? c : "color-mix(in oklab, var(--foreground) 7%, transparent)" }} />)}</div>
      case "meter": return (
        <div className="flex flex-col gap-[5px]">
          {[62, 34].map((w, i) => <span key={i} className="block h-[4px] overflow-hidden rounded-full bg-foreground/[0.08]"><span className="block h-full rounded-full" style={{ width: `${w}%`, background: c }} /></span>)}
        </div>
      )
      case "check": return (
        <div className="flex flex-col gap-[4px]">
          {["55%", "42%", "60%"].map((w, i) => <div key={i} className="flex items-center gap-1"><span className="size-[5px] shrink-0 rounded-[1.5px] border-[0.5px] border-foreground/30" style={i ? undefined : { background: c, borderColor: c }} /><Bar w={w} /></div>)}
        </div>
      )
      case "tiles": return <div className="grid flex-1 grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className="flex items-end rounded-[3px] bg-foreground/[0.06] p-[2px]"><span className="size-[4px] rounded-full" style={{ background: i < 3 ? "var(--green)" : dim }} /></span>)}</div>
      case "list": return (
        <div className="flex flex-col gap-[4px]">
          {["60%", "45%", "52%"].map((w, i) => <div key={i} className="flex items-center gap-1"><span className="size-[4px] shrink-0 rounded-full" style={{ background: i ? dim : c }} /><Bar w={w} /></div>)}
        </div>
      )
      default: return <><Bar w="50%" style={{ background: c }} /><Bar w="75%" /></>
    }
  })()
  return <div className="flex h-[32px] flex-col gap-1 overflow-hidden rounded-[5px] bg-card p-1.5 shadow-[0_0_0_0.5px_var(--border)]">{body}</div>
}

/** The tint of the plugin a block is from (else one of a few colours, by its place). */
function tintOfBlock(block: string, i: number) {
  const p = PLUGINS.find((x) => x.blockDecls?.[block])
  const t = p && p.id !== "query" ? tintOfPlugin(p.id) : null
  return t && t !== "var(--primary)" ? t : PALETTE[i % PALETTE.length]
}

/** The page the bundle opens on: a dashboard of a few of its blocks, or a note when it pins nothing. */
function MiniPage({ b }: { b: BundleInfo }) {
  const roomy = b.density === "comfortable"
  if (b.home === null) return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-[5px] overflow-hidden", roomy ? "px-4 pt-3.5" : "px-3 pt-3")}>
      <Bar w="58%" className="mb-1 h-[8px] rounded-[3px] bg-foreground/[0.16]" />
      {["100%", "94%", "97%", "48%"].map((w, i) => <Bar key={i} w={w} />)}
      <div className="mt-1 flex gap-1"><Bar w="26%" /><Bar w="22%" style={{ background: `color-mix(in oklab, ${tintOfBundle(b)} 70%, transparent)` }} /><Bar w="40%" /></div>
      {["90%", "72%"].map((w, i) => <Bar key={i} w={w} />)}
      <Bar w="34%" className="mt-1.5 h-[6px] bg-foreground/[0.13]" />
      {["96%", "88%"].map((w, i) => <Bar key={i} w={w} />)}
    </div>
  )
  // Four blocks, in the page's order: each shape's first, then the next ones, so a page of many boards still shows its table.
  const all = b.home.map((x, i) => ({ ...x, i, shape: shapeOf(x) }))
  const seen = new Set<Shape>()
  const firsts = all.filter((x) => !seen.has(x.shape) && !!seen.add(x.shape))
  const keep = new Set([...firsts, ...all.filter((x) => !firsts.includes(x))].slice(0, 4))
  const blocks = all.filter((x) => keep.has(x))
  return (
    <div className={cn("grid min-w-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-hidden", roomy ? "px-3.5 pt-3" : "p-2.5")}>
      <div className="col-span-2 mb-0.5 flex items-center gap-1.5"><Square c={tintOfBundle(b)} /><Bar w="40%" className="h-[7px] rounded-[3px] bg-foreground/[0.14]" /></div>
      {blocks.length
        ? blocks.map((x, j) => <div key={j} className={x.wide || (j === blocks.length - 1 && j % 2 === 0) ? "col-span-2" : undefined}><MiniBlock shape={x.shape} c={tintOfBlock(x.block, x.i)} /></div>)
        : PALETTE.slice(0, 4).map((c, i) => <MiniBlock key={i} shape="card" c={c} />)}
    </div>
  )
}

/** A small picture of the app a bundle makes: its preview.png, else a sketch in its own colours (its sidebars and the
 *  page it opens on). */
function Thumb({ b }: { b: BundleInfo }) {
  const url = usePicture(b)
  if (url) return <img src={url} alt="" draggable={false} className="aspect-[16/10] w-full rounded-t-[11px] border-b-[0.5px] border-border bg-background object-cover object-top-left" />
  return <Sketch b={b} />
}

function Sketch({ b }: { b: BundleInfo }) {
  const { scheme: mine, theme } = usePrefs()
  const scheme = b.scheme ?? mine
  const dark = (b.theme ?? theme) === "dark" || ((b.theme ?? theme) === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  const left = b.panels?.left ?? ["search:search", "pages:pages"], right = b.panels?.right ?? []
  const folded = b.panels?.collapsed ?? []
  return (
    <div aria-hidden data-scheme={scheme === "default" ? undefined : scheme}
      className={cn("scheme-preview flex aspect-[16/10] overflow-hidden rounded-t-[11px] border-b-[0.5px] border-border bg-background text-foreground", dark && "dark")}>
      {left.length > 0 && (
        <div className={cn("flex shrink-0 flex-col gap-[7px] overflow-hidden border-r-[0.5px] border-border bg-sidebar px-2.5 pt-2.5", right.length ? "w-[32%]" : "w-[36%]")}>
          {left.map((k) => <MiniPanel key={k} k={k} b={b} folded={folded.includes(k)} />)}
        </div>
      )}
      <MiniPage b={b} />
      {right.length > 0 && (
        <div className="flex w-[19%] shrink-0 flex-col gap-[7px] overflow-hidden border-l-[0.5px] border-border bg-sidebar px-2 pt-2.5">
          {right.map((k) => <MiniPanel key={k} k={k} b={b} folded={folded.includes(k)} narrow />)}
        </div>
      )}
    </div>
  )
}

/** A bundle: its picture and name, nothing to read (what it changes is in its preview); only a warning when it runs
 *  code or can't be read. */
function BundleCard({ b, picked }: { b: BundleInfo; picked?: boolean }) {
  const Icon = iconOfBundle(b)
  return (
    <div className="group/card relative flex min-w-0 flex-col">
      <button type="button" onClick={() => openDetail(`bundle/${b.id}`)} data-bundle={b.id} data-keyrow aria-label={`${b.name}: preview`}
        className={cn("glass flex min-w-0 flex-1 cursor-pointer flex-col rounded-[12px] text-left ring-primary/60 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none", picked && "ring-2 ring-primary")}>
        <Thumb b={b} />
        <div className="flex min-w-0 flex-1 flex-col p-3.5 pt-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-muted" style={{ color: tintOfBundle(b) }}>
              <Icon className="size-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{b.name}</span>
            {b.inUse && !picked && <span className="shrink-0 rounded-[5px] bg-primary/12 px-1.5 text-[11px] leading-[18px] font-medium text-primary" data-bundle-in-use data-tip="Your setup is this one: applying it changes nothing">In use</span>}
            {picked && <span className="shrink-0 rounded-[5px] bg-primary/12 px-1.5 text-[11px] leading-[18px] font-medium text-primary" data-bundle-picked>Picked</span>}
          </div>
          {(!!b.code.length || !!b.problems.length) && (
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[12px]">
              {!!b.code.length && (b.source === "app" ? <span className="text-muted-foreground">Installs plugins</span>
                : <span className="font-medium text-[var(--red)]">Runs code</span>)}
              {!!b.problems.length && <span className="text-[var(--red)]" data-tip={b.problems.join("\n")}>Can't be read</span>}
            </div>
          )}
        </div>
      </button>
      {b.source === "vault" && (
        <button type="button" aria-label={`${b.name}: more`} data-tip="More" onClick={(e) => menuBelow(e, [
          { label: "Share…", icon: Share, run: () => openDetail(`bundle-share/${b.id}`) },
          ...(b.from ? [{ label: "Get the newest", icon: RefreshCw, run: () => { void fetchAgain(b) } }] : []),
          { label: "Delete", icon: Trash2, danger: true, run: () => { void removeBundle(b) } },
        ])}
          className="absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-[7px] bg-background/80 text-muted-foreground opacity-0 backdrop-blur group-hover/card:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100">
          <MoreHorizontal className="size-4" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

/** Get a bundle again from the repository it came from (its newest version replaces it). */
async function fetchAgain(b: BundleInfo) {
  try { await importText(b.from!); notify(`${b.name} is the newest from ${b.from}`) } catch (e) { notifyError(e, `Couldn't get ${b.name} again`) }
}

/** Delete one of the user's bundles (to the trash), with Undo: its export, imported again. */
async function removeBundle(b: BundleInfo) {
  try {
    const copy = await bundleText(b, { all: true }).catch(() => null)
    await deleteBundle(b)
    if (copy) notify(`Deleted ${b.name}`, { action: { label: "Undo", run: () => importText(copy) } })
  } catch (e) { notifyError(e, "Couldn't delete it") }
}

/** Pasting a bundle (its JSON, a repository's name) or dropping its file anywhere on the page opens its import, when
 *  nothing else takes it (a field, a sheet). Whether a file is being dragged over it. */
function useImportGestures(root: RefObject<HTMLDivElement | null>) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")
    const paste = (e: ClipboardEvent) => {
      // (a page kept hidden in its pane has no offsetParent; two showing it take one paste once)
      if (e.defaultPrevented || !el.offsetParent || document.querySelector("dialog[open]") || editable(e.target)) return
      const file = [...e.clipboardData?.files ?? []].find((f) => /json/.test(f.type) || f.name.endsWith(".json"))
      const text = e.clipboardData?.getData("text/plain") ?? ""
      if (!file && !isBundleText(text)) return
      e.preventDefault()
      openImport(file ?? text)
    }
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files")
    const enter = (e: DragEvent) => { if (!files(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; setOver(true) }
    const leave = (e: DragEvent) => { if (!el.contains(e.relatedTarget as Node | null)) setOver(false) }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      setOver(false)
      const f = e.dataTransfer!.files[0]
      if (f) openImport(f)
    }
    document.addEventListener("paste", paste)
    el.addEventListener("dragover", enter)
    el.addEventListener("dragleave", leave)
    el.addEventListener("drop", drop)
    return () => {
      document.removeEventListener("paste", paste)
      el.removeEventListener("dragover", enter)
      el.removeEventListener("dragleave", leave)
      el.removeEventListener("drop", drop)
    }
  }, [root])
  return over
}

// Three across as soon as three fit (the built-ins are three: never two and one alone).
const GRID = "grid grid-cols-1 gap-3 @lg:grid-cols-3"

/** Where imported bundles land, so where importing starts; lit while a file is dragged over the page. */
function ImportCard({ over }: { over: boolean }) {
  return (
    <button type="button" onClick={() => openDetail("bundle-import")} data-bundles-import-tile
      className={cn("flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-dashed px-4 py-5 text-center transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none",
        over ? "border-primary bg-primary/8" : "border-foreground/15 hover:border-primary/60 hover:bg-primary/5")}>
      <span className="grid size-9 place-items-center rounded-full bg-primary/12 text-primary"><Import className="size-[18px]" strokeWidth={2.25} /></span>
      <span className="text-[15px] font-semibold">Import a bundle</span>
      <span className="text-[13px] leading-[18px] text-muted-foreground">Paste it, drop its file or name a GitHub repository</span>
    </button>
  )
}

/** `section`: drawn as Settings' section. */
export function Bundles({ store, section }: { store: Store; section?: boolean }) {
  const l = useBundles()
  const prev = store.bundles?.previous ?? null
  const welcome = !!store.bundles?.onboarding
  // The list follows the vault (a bundle saved or imported by an AI, from another device).
  const files = store.files
  useEffect(() => { void refreshBundles() }, [files])
  const app = l?.bundles.filter((b) => b.source === "app") ?? []
  const mine = l?.bundles.filter((b) => b.source === "vault") ?? []
  const start = app.find((b) => b.id === l?.default)
  const root = useRef<HTMLDivElement>(null)
  const over = useImportGestures(root)
  return (
    <div ref={root} className="relative min-h-full" data-file-drop data-bundles-page>
      <PageHeader title={welcome ? "Welcome to Vaultite" : "Bundles"} section={section} subtitle={welcome ? "Pick a setup to start from. You can change all of it later." : undefined}>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {welcome
            ? <Button look="primary" onClick={() => skipOnboarding().catch((e) => notifyError(e))} data-bundles-skip>Start with {start?.name ?? "the default"}</Button>
            : <>
              <Button onClick={() => openDetail("bundle-import")} data-bundles-import><Import className="size-4" strokeWidth={2.25} />Import</Button>
              <Button look="primary" onClick={() => void startSave()} data-bundles-save><Plus className="size-4" strokeWidth={2.25} />Save current setup</Button>
            </>}
        </div>
      </PageHeader>
      {prev && (
        <div className="glass mb-5 flex items-center gap-3 rounded-[12px] px-4 py-3" data-bundles-previous>
          <History className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">Applied {prev.name} {fmtAgo(prev.at)}</div>
          </div>
          <Button onClick={() => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it"))}>Restore previous setup</Button>
        </div>
      )}
      <div className="@container" data-keylist>
        {!welcome && <h2 className="mb-2 text-[17px] font-semibold">Built in</h2>}
        <div className={cn(GRID, "mb-7")} data-bundles-app>
          {app.map((b) => <BundleCard key={b.id} b={b} picked={welcome && b.id === start?.id} />)}
        </div>
        {/* (like a phone's setup offering to restore from a backup: there, not in the way) */}
        {welcome && (
          <p className="mb-6 text-[14px] text-muted-foreground" data-bundles-welcome-import>
            Have a bundle? <button type="button" onClick={() => openDetail("bundle-import")} className="cursor-pointer font-medium text-primary hover:underline">Import it</button>
          </p>
        )}
        {(!welcome || mine.length > 0) && <>
          <h2 className="mb-2 text-[17px] font-semibold">Yours</h2>
          <div className={cn(GRID, "mb-6")} data-bundles-mine>
            {mine.map((b) => <BundleCard key={b.id} b={b} />)}
            <ImportCard over={over} />
          </div>
        </>}
      </div>
      {over && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[12px] border-2 border-dashed border-primary/60 bg-background/85 text-[15px] font-medium" data-bundles-drop>
          Drop to import the bundle
        </div>
      )}
    </div>
  )
}

// ---------- a bundle's preview: what applying it changes here ----------

/** `file`: an import's export (its pictures are in it). */
type Preview = { bundle: BundleInfo; plan: Plan; pages?: Record<string, { icon: string | null; tint: string | null; plugin: string | null }>; file?: unknown }

const showValue = (v: unknown) => (v === null || v === undefined ? "default" : typeof v === "boolean" ? (v ? "on" : "off") : Array.isArray(v) ? v.join(", ") || "none" : String(v))

function Chip({ id, off }: { id: string; off?: boolean }) {
  const p = pluginById(id)
  const Icon = p?.icon ?? Puzzle
  return (
    <span className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-[7px] bg-foreground/[0.05] pr-2.5 pl-1.5 text-[13px]", off && "text-muted-foreground")}>
      <Icon className={cn("size-4 shrink-0", off && "opacity-60")} strokeWidth={2} style={{ color: off ? undefined : tintOfPlugin(id) }} />
      <span className={cn("truncate", off && "line-through decoration-foreground/30")}>{p?.name ?? id}</span>
    </span>
  )
}

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground">{title}{count !== undefined && <span className="ml-1 font-normal">{count}</span>}</div>
      {children}
    </div>
  )
}

/** A panel by its key ("terminal:sessions"): its title and icon, from its plugin's definition. */
function panelLook(key: string) {
  const [pid, name] = key.split(":")
  const p = pluginById(pid)
  const def = p?.sidebar?.[name]
  return { title: def ? (def.heading || def.title) : name, icon: (def?.flyout?.icon ?? p?.icon ?? PanelLeft) as LucideIcon, tint: tintOfPlugin(pid) }
}

function Side({ side, keys, collapsed }: { side: string; keys: string[]; collapsed: string[] }) {
  const Icon = side === "Left" ? PanelLeft : PanelRight
  return (
    <div className="min-w-0 flex-1 rounded-[10px] bg-foreground/[0.035] p-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-muted-foreground"><Icon className="size-3.5" strokeWidth={2.25} />{side}</div>
      {!keys.length && <div className="px-1 py-1 text-[13px] text-muted-foreground">Nothing: takes no room</div>}
      {keys.map((k) => {
        const p = panelLook(k)
        return (
          <div key={k} className="flex h-7 items-center gap-2 px-1 text-[13px]">
            <p.icon className="size-4 shrink-0" strokeWidth={2} style={{ color: p.tint }} />
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
            {collapsed.includes(k) && <span className="text-[12px] text-muted-foreground">folded</span>}
          </div>
        )
      })}
    </div>
  )
}

function PageRow({ path, look, state }: { path: string; look?: { icon: string | null; tint: string | null; plugin: string | null }; state?: "new" | "kept" | "off" }) {
  const Icon = namedIcon(look?.icon) ?? (look?.plugin ? pluginById(look.plugin)?.icon : null) ?? LayoutDashboard
  return (
    <div className={cn("flex h-8 items-center gap-2 text-[14px]", state === "off" && "text-muted-foreground")}>
      <Icon className={cn("size-4 shrink-0", state === "off" && "opacity-60")} strokeWidth={2} style={{ color: state === "off" ? undefined : tintOf(look?.tint) ?? (look?.plugin ? tintOfPlugin(look.plugin) : "var(--muted-foreground)") }} />
      <span className={cn("min-w-0 flex-1 truncate", state === "off" && "line-through decoration-foreground/30")}>{stem(path)}</span>
      {state === "new" && <span className="rounded-[5px] bg-primary/12 px-1.5 text-[11px] leading-[18px] font-medium text-primary">pinned</span>}
      {state === "kept" && <span className="text-[12px] text-muted-foreground">yours</span>}
    </div>
  )
}

/** Applying runs code from it: ask first (Vaultite's own plugins, said so: they come from Vaultite's plugins). */
const askToRun = (b: BundleInfo, plan: Plan) => plan.code.every((c) => c.source && official(c.source)) ? confirmDialog({
  title: `Install ${new Intl.ListFormat("en", { type: "conjunction" }).format(plan.code.map((c) => c.name))}?`,
  body: `${b.name} installs Vaultite's own plugins from its plugin directory. Like any plugin, they run on the machine that serves this app, with your files.`,
  confirm: "Install and apply",
}) : confirmDialog({
  title: `Run code from ${b.name}?`,
  body: `It brings vault plugins (${plan.code.map((c) => c.source && !c.kept ? `${c.name}, from ${c.source}` : c.name).join("; ")}). They run on the machine that serves this app, with your files and permissions. Apply bundles that run code only from people you trust.`,
  confirm: "Apply and run them", danger: true,
})

/** What applying a bundle changes here, then Apply. */
export function BundlePreview({ id }: { id: string }) {
  const [p, setP] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offAdded, setOffAdded] = useState(false)
  useEffect(() => { previewOf(id).then((x) => setP(x as Preview), (e) => setError(errorText(e))) }, [id])
  if (error) return <SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title="Can't open this bundle" sub={error} />
  if (!p) return <div aria-busy><SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title={<Line w="45%" />} sub={<Line w="70%" />} /></div>
  const { bundle: b, plan } = p
  const code = runsCode(plan)
  const apply = async () => {
    if (code && !(await askToRun(b, plan))) return
    setBusy(true)
    try {
      closeDetail()
      await applyBundle(b, plan, code, offAdded)
    } catch (e) { notifyError(e, `Couldn't apply ${b.name}`) } finally { setBusy(false) }
  }
  return (
    <div data-bundle-preview={b.id}>
      <SheetHead icon={iconOfBundle(b)} tint={tintOfBundle(b)} kicker={b.source === "app" ? "Built-in bundle" : b.from ? `From ${b.from}` : "Your bundle"} title={b.name} sub={b.description || undefined} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button look="primary" disabled={busy || (plan.empty && !offAdded) || !!b.problems.length} onClick={apply} data-bundle-apply>
          {plan.empty && !offAdded ? "This is your setup already" : <>Apply {b.name}<ArrowRight className="size-4" strokeWidth={2.25} /></>}
        </Button>
        {b.source === "vault" && <Button onClick={() => openDetail(`bundle-share/${b.id}`)} data-bundle-share><Share className="size-4" strokeWidth={2} />Share</Button>}
        {b.source === "vault" && <Button onClick={() => { closeDetail(); void removeBundle(b) }}><Trash2 className="size-4" strokeWidth={2} />Delete</Button>}
      </div>
      <Changes p={p} offAdded={offAdded} setOffAdded={setOffAdded} />
    </div>
  )
}

/** A bundle given to the app (openImport), before it's added: what applying it would change, then Apply (added, then
 *  applied) or Add (to the user's bundles). Reloaded, what it was given is gone: the Import sheet instead. */
export function IncomingBundle({ id }: { id: string }) {
  const [source] = useState(() => givenImport(id))
  const [inc, setInc] = useState<Incoming | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offAdded, setOffAdded] = useState(false)
  const l = useBundles()
  useEffect(() => { if (source) incomingOf(source).then(setInc, (e) => setError(errorText(e))) }, [source])
  if (!source) return <ImportBundle />
  const repo = typeof source === "string" && !source.trim().startsWith("{") && !source.includes("\n") ? source.trim() : null
  if (error) return (
    <div data-bundle-incoming-error>
      <SheetHead icon={Import} tint="var(--muted-foreground)" kicker="Import" title="Can't import this bundle" sub={error} />
      <Button onClick={() => replaceDetail("bundle-import")}>Import another…</Button>
    </div>
  )
  if (!inc) return <div aria-busy><SheetHead icon={Import} tint="var(--muted-foreground)" kicker={repo ? `Getting it from ${repo}` : "Import"} title={<Line w="45%" />} sub={<Line w="70%" />} /></div>
  const { bundle: b, plan } = inc
  const code = runsCode(plan)
  const replaces = l?.bundles.find((x) => x.id === inc.replaces) ?? null
  const add = async (then: (added: BundleInfo) => Promise<void>) => {
    setBusy(true)
    try {
      const added = await addIncoming(inc)
      closeDetail()
      await then(added)
    } catch (e) { notifyError(e, `Couldn't import ${b.name}`) } finally { setBusy(false) }
  }
  const apply = async () => {
    if (code && !(await askToRun(b, plan))) return
    await add((added) => applyBundle(added, plan, code, offAdded))
  }
  const keep = () => add(async (added) => { notify(`Added ${added.name} to your bundles`, { action: { label: "Preview", run: () => openDetail(`bundle/${added.id}`) } }) })
  return (
    <div data-bundle-incoming={b.id}>
      <SheetHead icon={iconOfBundle(b)} tint={tintOfBundle(b)} kicker={b.from ? `From ${b.from}` : "Import"} title={b.name} sub={b.description || undefined} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button look="primary" disabled={busy || !!b.problems.length} onClick={() => void apply()} data-bundle-incoming-apply>Apply {b.name}<ArrowRight className="size-4" strokeWidth={2.25} /></Button>
        <Button disabled={busy || !!b.problems.length} onClick={() => void keep()} data-bundle-incoming-add><Plus className="size-4" strokeWidth={2.25} />{replaces ? `Update ${replaces.name}` : "Add to your bundles"}</Button>
      </div>
      <p className="-mt-2 mb-5 text-[13px] leading-[18px] text-muted-foreground">
        {replaces ? `It replaces your ${replaces.name}, from the same repository. ` : ""}Either way it's kept in your bundles, to apply again or share.
      </p>
      {plan.empty && <p className="mb-4 text-[14px] text-muted-foreground">Applying it changes nothing here: it's your setup already.</p>}
      <Changes p={inc} offAdded={offAdded} setOffAdded={setOffAdded} />
    </div>
  )
}

/** A preview's body: what applying the bundle changes here (plugins, panels, pins, the look, settings, files). */
function Changes({ p, offAdded, setOffAdded }: { p: Preview; offAdded: boolean; setOffAdded: (v: boolean) => void }) {
  const { bundle: b, plan } = p
  const code = runsCode(plan)
  const pins = plan.pins
  const added = plan.plugins.added ?? []
  const picture = usePicture(b, p.file)
  return (
    <>
      {b.on !== null && <p className="-mt-2 mb-4 text-[13px] leading-[18px] text-muted-foreground" data-bundle-reach>Applies to every window and device on this vault; agents lose the tools of plugins it turns off.</p>}
      {code && (
        <div className="mb-4 flex gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--red)_10%,transparent)] p-3.5" data-bundle-code>
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--red)]" strokeWidth={2} />
          <div className="text-[14px] leading-[20px]">
            <div className="font-semibold">It runs code on this machine</div>
            <div className="text-muted-foreground">It brings vault plugins: {plan.code.map((c) => c.name + (c.kept ? " (you have one by that name: yours stays)" : c.source ? ` (installed from ${c.source})` : "")).join(", ")}. Applying asks you first.</div>
          </div>
        </div>
      )}
      {!!b.problems.length && <p className="mb-4 text-[14px] text-[var(--red)]">{b.problems.join(". ")}</p>}
      {picture && <img src={picture} alt={`${b.name}, as it looks`} className="mb-4 w-full rounded-[12px] border-[0.5px] border-border" data-bundle-picture />}
      <div className="grid grid-cols-1 gap-3">
        {(plan.plugins.on.length > 0 || plan.plugins.off.length > 0 || plan.plugins.missing.length > 0 || added.length > 0) && (
          <Panel title="Plugins" icon={Puzzle}>
            {!!plan.plugins.on.length && <Group title="Turns on" count={plan.plugins.on.length}><div className="flex flex-wrap gap-1.5">{plan.plugins.on.map((x) => <Chip key={x} id={x} />)}</div></Group>}
            {!!plan.plugins.off.length && <Group title="Turns off" count={plan.plugins.off.length}><div className="flex flex-wrap gap-1.5">{plan.plugins.off.map((x) => <Chip key={x} id={x} off />)}</div></Group>}
            {!!plan.plugins.missing.length && <Group title="Not in this app (skipped)"><p className="text-[13px] text-muted-foreground">{plan.plugins.missing.join(", ")}</p></Group>}
            {!!added.length && (
              <Group title={offAdded ? "Plugins you added: turned off too" : "Plugins you added stay as they are"} count={added.length}>
                <div className="flex flex-wrap gap-1.5" data-bundle-added>{added.map((x) => <Chip key={x} id={x} off={offAdded} />)}</div>
                <div className="mt-2 flex min-h-10 items-center gap-3">
                  <span className="min-w-0 flex-1 text-[14px]">Turn those off too<span className="block text-[13px] text-muted-foreground">Restore previous setup turns them back on</span></span>
                  <Switch on={offAdded} onChange={setOffAdded} label="Turn the plugins you added off too" />
                </div>
              </Group>
            )}
          </Panel>
        )}
        {plan.panels.setup && plan.panels.changed && (
          <Panel title="Sidebars" icon={PanelLeft}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Side side="Left" keys={plan.panels.setup.left} collapsed={plan.panels.setup.collapsed} />
              <Side side="Right" keys={plan.panels.setup.right} collapsed={plan.panels.setup.collapsed} />
            </div>
            <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">
              The default panels, and this workspace's{plan.panels.workspace ? " (its own panels are replaced)" : ""}. Your other workspaces keep theirs.
            </p>
          </Panel>
        )}
        {pins && (pins.pin.length > 0 || pins.unpin.length > 0 || pins.list.length > 0) && (
          <Panel title="Pinned pages" icon={Pin}>
            {!pins.list.length && <p className="text-[14px] text-muted-foreground">None</p>}
            {pins.list.map((x) => <PageRow key={x} path={x} look={p.pages?.[x]} state={pins.want.includes(x) ? (pins.pin.includes(x) ? "new" : undefined) : "kept"} />)}
            {!!pins.unpin.length && (
              <div className="mt-2 border-t-[0.5px] border-border pt-2">
                <div className="mb-0.5 text-[12px] font-semibold tracking-wide text-muted-foreground">Unpinned (the files stay)</div>
                {pins.unpin.map((x) => <PageRow key={x} path={x} look={p.pages?.[x]} state="off" />)}
              </div>
            )}
            {!!pins.missing.length && <p className="mt-2 text-[13px] text-muted-foreground">Not here, so not pinned: {pins.missing.map(stem).join(", ")}</p>}
          </Panel>
        )}
        {(plan.appearance.length > 0 || plan.newtab.length > 0) && (
          <Panel title="Look" icon={Settings2}>
            {(() => {
              const scheme = plan.appearance.find((c) => c.key === "scheme")?.to as string | undefined
              const theme = plan.appearance.find((c) => c.key === "theme")?.to as string | undefined
              return scheme ? <Swatches id={scheme} mode={theme === "dark" || theme === "light" ? theme : undefined} className="mb-2 h-12 max-w-[280px]" /> : null
            })()}
            {plan.appearance.map((c) => <Setting key={c.key} label={APPEARANCE[c.key] ?? c.key} from={c.from} to={c.to} />)}
            {plan.newtab.map((c) => <Setting key={`newtab.${c.key}`} label={NEWTAB[c.key] ?? `New tab: ${c.key}`} from={c.key === "page" && typeof c.from === "string" ? stem(c.from) : c.from}
              to={c.key === "page" && typeof c.to === "string" ? stem(c.to) : c.to} />)}
          </Panel>
        )}
        {(plan.settings.length > 0 || plan.hotkeys.length > 0 || plan.skipped.length > 0) && (
          <Panel title="Settings" icon={Settings2}>
            {plan.settings.map((s) => {
              const pl = pluginById(s.plugin)
              const decl = pl?.settingsDecls?.[s.key]
              return <Setting key={`${s.plugin}.${s.key}`} label={`${pl?.name ?? s.plugin}: ${decl?.label ?? s.key}`} from={s.from} to={s.to} labels={decl?.labels} />
            })}
            {plan.hotkeys.map((h) => <Setting key={h.key} label={`Hotkey: ${h.key}`} from={h.from} to={h.to} />)}
            {plan.skipped.length > 0 && <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground" data-bundle-skipped>Kept as they are: {plan.skipped.map((x) =>
              `${pluginById(x.plugin)?.name ?? x.plugin}: ${pluginById(x.plugin)?.settingsDecls?.[x.key]?.label ?? x.key} (${x.why})`).join("; ")}</p>}
          </Panel>
        )}
        {plan.files.add.length > 0 && (
          <Panel title="Adds" icon={FilePlus}>
            {plan.files.add.map((f) => <div key={f} className="flex h-7 items-center text-[14px]"><span className="truncate">{f}</span></div>)}
            {plan.files.kept.length > 0 && <p className="mt-1 text-[13px] text-muted-foreground">Already here, kept as they are: {plan.files.kept.map(stem).join(", ")}</p>}
          </Panel>
        )}
      </div>
    </>
  )
}

const NEWTAB: Record<string, string> = { page: "New tab's page", sections: "New tab's sections", actions: "New tab's buttons", icons: "New tab's button icons" }
const APPEARANCE: Record<string, string> = {
  theme: "Theme", scheme: "Colour scheme", density: "Density", fileIcons: "File icons", tabBar: "Tab bar", paneTitles: "Pane titles", rails: "Sidebar rails", lineNumbers: "Line numbers", statusBar: "Status bar", statusBarMore: "Status bar tray", fileBar: "File top bar", pullActions: "Pull-down actions", sidebarScroll: "Sidebar scrolling", panelDividers: "Lines between sidebar panels", quickTextSize: "Quick text size",
  interfaceFont: "Interface font", textFont: "Text font", monoFont: "Monospace font", snippets: "CSS snippets",
}

function Setting({ label, from, to, labels }: { label: string; from: unknown; to: unknown; labels?: Record<string, string> }) {
  const name = (v: unknown) => (labels && v !== null && v !== undefined && labels[String(v)]) || showValue(v)
  return (
    <div className="flex min-h-8 items-center gap-3 text-[14px]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-muted-foreground line-through decoration-foreground/25">{name(from)}</span>
      <ArrowRight className="size-3.5 shrink-0 text-tertiary" strokeWidth={2.25} />
      <span className="shrink-0 font-medium">{name(to)}</span>
    </div>
  )
}

// ---------- saving the current setup ----------

export function SaveBundle() {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [shot] = useState(takenShot)
  const [picture, setPicture] = useState(!!shot)
  const [hotkeys, setHotkeys] = useState(false)
  const [code, setCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const l = useBundles()
  const prefs = usePrefs()
  const on = usePlugins().filter((x) => x.tier === "vault" && switchedOn(x, prefs))
  // (installed ones go as where they come from, always; the vault's own as their code, when asked)
  const vaultOn = on.filter((x) => !x.meta?.source).length, installed = on.length - vaultOn
  const clash = l?.bundles.find((b) => b.source === "vault" && b.name.toLowerCase() === name.trim().toLowerCase())
  useSheetGuard(() => [name.trim() && `Name: ${name.trim()}`, description.trim() && `Description: ${description.trim()}`].filter((x) => !!x))
  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const b = await saveBundle({ name, description, hotkeys, vaultPlugins: code, ...(picture && shot ? { preview: shot } : {}), replace: !!clash })
      closeDetail()
      notify(`Saved ${b.name}`, { action: { label: "Share", run: () => openDetail(`bundle-share/${b.id}`) } })
    } catch (e) { notifyError(e, "Couldn't save it") } finally { setBusy(false) }
  }
  const input = "h-10 w-full rounded-[8px] border-[0.5px] border-border bg-card px-3 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-9 md:text-[14px]"
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} data-bundle-save-form>
      <SheetHead icon={Package} tint="var(--primary)" kicker="Bundles" title="Save current setup"
        sub="As a bundle in this vault's .vaultite/bundles: apply it again later, or export it to share." />
      <div className="grid grid-cols-1 gap-3">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My setup" className={input} data-bundle-name />
          {clash && <span className="mt-1 block text-[13px] text-muted-foreground">Replaces your bundle {clash.name}.</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it's for" className={input} />
        </label>
        <Panel className="py-1">
          <div className="hairline flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
            {shot && (
              <div className="flex min-h-12 items-center gap-3 py-2">
                <img src={`data:image/png;base64,${shot}`} alt="" className="h-10 w-16 shrink-0 rounded-[5px] border-[0.5px] border-border object-cover object-top-left" />
                <div className="min-w-0 flex-1"><div className="text-[15px]">Picture</div><div className="text-[13px] text-muted-foreground">The window as it is, for its card</div></div>
                <Switch on={picture} onChange={setPicture} label="Include the picture" />
              </div>
            )}
            <div className="flex min-h-12 items-center gap-3 py-2">
              <div className="min-w-0 flex-1"><div className="text-[15px]">Hotkeys</div><div className="text-[13px] text-muted-foreground">Your keyboard shortcuts, from hotkeys.json</div></div>
              <Switch on={hotkeys} onChange={setHotkeys} label="Include hotkeys" />
            </div>
            {vaultOn > 0 && (
              <div className="flex min-h-12 items-center gap-3 py-2">
                <div className="min-w-0 flex-1"><div className="text-[15px]">Plugins made in this vault</div><div className="text-[13px] text-muted-foreground">{vaultOn} on, as their code. Whoever applies the bundle is asked first</div></div>
                <Switch on={code} onChange={setCode} label="Include vault plugins" />
              </div>
            )}
          </div>
        </Panel>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          It keeps which plugins are on, their settings that differ from the defaults (not who may reach this machine), the sidebars and pinned
          pages{currentWorkspace() ? " (this workspace's)" : ""}, the dashboards they need, the look and what a new tab shows{installed ? `, and the ${installed === 1 ? "plugin" : `${installed} plugins`} you installed, by where they come from` : ""}. Not your notes.
        </p>
        <div><Button look="primary" type="submit" disabled={busy || !name.trim()} data-bundle-save>{clash ? "Replace" : "Save"}</Button></div>
      </div>
    </form>
  )
}

// ---------- sharing and importing ----------

const PART: Record<ShareItem["kind"], (x: ShareItem) => string> = {
  picture: () => "A picture of your window: it may show your notes",
  page: (x) => (x.own ? "A page with text of your own" : "A page it pins"),
  file: () => "A file it brings",
  settings: (x) => `Settings: ${x.keys?.join(", ") || "none"}`,
  hotkeys: () => "Your keyboard shortcuts",
  code: () => "A plugin made in your vault: its code",
}

/** Share a bundle as one file: what it sends (the user's own parts off at first), then Copy, Copy for an agent, Save. */
export function ShareBundle({ id }: { id: string }) {
  const b = useBundles()?.bundles.find((x) => x.id === id)
  const [parts, setParts] = useState<{ items: ShareItem[]; dropped: string[] } | null>(null)
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    shareOf(id).then((p) => { setParts(p); setOn(Object.fromEntries(p.items.map((x) => [x.path, x.on]))) }, (e) => setError(errorText(e)))
  }, [id])
  // (made before a button is pressed: Safari copies only in the press itself)
  useEffect(() => {
    if (!parts || !b) return
    let live = true
    setText(null)
    const include = parts.items.filter((x) => !x.on && on[x.path]).map((x) => x.path), leave = parts.items.filter((x) => x.on && !on[x.path]).map((x) => x.path)
    bundleText(b, { include, leave }).then((t) => { if (live) setText(t) }, (e) => { if (live) setError(errorText(e)) })
    return () => { live = false }
  }, [parts, on, b?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <SheetHead icon={Share} tint="var(--muted-foreground)" kicker="Share" title="Can't share this bundle" sub={error} />
  if (!b || !parts) return <div aria-busy><SheetHead icon={Share} tint="var(--muted-foreground)" kicker="Share" title={<Line w="45%" />} sub={<Line w="70%" />} /></div>
  const copy = async (agent: boolean) => {
    if (!text) return
    if (await copyText(agent ? agentPrompt(b, text) : text)) notify(agent ? `Copied ${b.name}, with what an agent should do with it` : `Copied ${b.name}`)
    else notifyError(new Error("the clipboard can't be reached here"), "Couldn't copy it")
  }
  return (
    <div data-bundle-share-sheet={b.id}>
      <SheetHead icon={Share} tint={tintOfBundle(b)} kicker="Share" title={b.name} sub="One file with this setup, not your notes: send it to someone, or paste it to their agent." />
      <div className="mb-5 flex flex-wrap gap-2">
        <Button look="primary" disabled={!text} onClick={() => void copy(false)} data-bundle-copy><Copy className="size-4" strokeWidth={2} />Copy</Button>
        <Button disabled={!text} onClick={() => void copy(true)} data-bundle-copy-agent><Bot className="size-4" strokeWidth={2} />Copy for an agent</Button>
        <Button disabled={!text} onClick={() => exportBundle(b, text!).catch((e) => notifyError(e, "Couldn't save it"))} data-bundle-export><Download className="size-4" strokeWidth={2} />Save file</Button>
      </div>
      {parts.items.length > 0 && (
        <Panel title="What it sends" className="py-1">
          <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
            {parts.items.map((x) => (
              <div key={x.path} className="flex min-h-12 items-center gap-3 py-2" data-share-part={x.path}>
                <div className="min-w-0 flex-1"><div className="truncate text-[15px]">{x.kind === "page" ? stem(x.path) : x.label}</div><div className="text-[13px] text-muted-foreground">{PART[x.kind](x)}</div></div>
                <Switch on={!!on[x.path]} onChange={(v) => setOn((o) => ({ ...o, [x.path]: v }))} label={`Send ${x.label}`} />
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="mt-3 text-[13px] leading-[18px] text-muted-foreground">
        {parts.dropped.length > 0 && <>Never sent: pins to your own notes ({parts.dropped.map(stem).join(", ")}). </>}
        Plugins you installed go as where they come from: whoever applies it installs them, after saying yes.
      </p>
      <BundleLink b={b} />
    </div>
  )
}

/** Import a bundle: pasted (its JSON, or a GitHub repository's name), or a file. Added to the user's, not applied. */
export function ImportBundle() {
  const [text, setText] = useState("")
  const file = useRef<HTMLInputElement>(null)
  useSheetGuard(() => (text.trim() ? ["What you pasted"] : []))
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) openImport(text) }} data-bundle-import-form>
      <SheetHead icon={Import} tint="var(--primary)" kicker="Bundles" title="Import a bundle" sub="Its preview says what it would change, then you apply it or keep it in your bundles." />
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={7} spellCheck={false} data-bundle-import-text
        placeholder="Paste a bundle, or a GitHub repository (owner/name)"
        className="mb-3 block w-full resize-y rounded-[8px] border-[0.5px] border-border bg-card px-3 py-2 font-mono text-[16px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:text-[13px]" />
      <div className="flex flex-wrap gap-2">
        <Button look="primary" type="submit" disabled={!text.trim()} data-bundle-import>Preview</Button>
        <Button type="button" onClick={() => file.current?.click()}><FilePlus className="size-4" strokeWidth={2} />Choose a file…</Button>
      </div>
      <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) openImport(f) }} />
    </form>
  )
}
