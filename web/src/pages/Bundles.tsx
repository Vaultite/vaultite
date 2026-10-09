// Bundles: setups to start from, save and share (format: core/bundles.ts). The app's own page, opened by itself on a
// vault never opened before; a card opens a preview of what applying changes, asking first when it runs code.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  ArrowRight, Download, FilePlus, History, Import, LayoutDashboard, MoreHorizontal, Package, PanelLeft, PanelRight, Pin, Plus,
  Puzzle, Settings2, ShieldAlert, Trash2, type LucideIcon,
} from "lucide-react"
import type { Store } from "@/core/data"
import { dateText } from "@/core/data"
import {
  applyBundle, bundleText, deleteBundle, exportBundle, importBundle, previewOf, refreshBundles, restoreSetup, runsCode, saveBundle,
  skipOnboarding, useBundles, type BundleInfo,
} from "@/core/bundles"
import { closeDetail, openDetail } from "@/core/nav"
import { notify, notifyError } from "@/core/notify"
import { namedIcon, tintOf } from "@/core/pages"
import { PLUGINS, pluginById, switchedOn, tintOfPlugin, usePlugins } from "@/core/plugins"
import { currentWorkspace } from "@/core/scope"
import { usePrefs } from "@/core/prefs"
import { menuBelow } from "@/components/ContextMenu"
import { confirmDialog } from "@/components/ConfirmDialog"
import { useSheetGuard } from "@/components/DetailSheet"
import { PageHeader, Panel, SheetHead, Switch } from "@/components/kit"
import { Swatches } from "@/components/Appearance"
import { cn } from "@/lib/utils"

const stem = (p: string) => p.split("/").pop()!.replace(/\.(md|base|canvas|html|csv)$/, "")
const iconOfBundle = (b: Pick<BundleInfo, "icon">) => namedIcon(b.icon) ?? Package
const tintOfBundle = (b: Pick<BundleInfo, "tint">) => tintOf(b.tint) ?? "var(--primary)"
const button = "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-3.5 text-[15px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 md:h-8 md:text-[13px]"
const primary = cn(button, "bg-primary text-primary-foreground hover:bg-primary/85")
const secondary = cn(button, "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]")
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : dateText(new Date(iso), { day: "numeric", month: "short" })
}

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
  block === "query" ? (view === "board" || view === "cards" || view === "calendar" ? view : "table")
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

/** A small picture of the app a bundle makes, in its own colours: its sidebars and the page it opens on. */
function Thumb({ b }: { b: BundleInfo }) {
  const { scheme: mine, theme } = usePrefs()
  const scheme = b.scheme ?? mine
  const dark = (b.theme ?? theme) === "dark" || ((b.theme ?? theme) === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  const left = b.panels?.left ?? ["search:search", "pages:pages"], right = b.panels?.right ?? []
  const folded = b.panels?.collapsed ?? []
  return (
    <div aria-hidden data-scheme={scheme === "default" ? undefined : scheme}
      className={cn("scheme-preview flex h-[112px] overflow-hidden rounded-t-[11px] border-b-[0.5px] border-border bg-background text-foreground", dark && "dark")}>
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
function BundleCard({ b, applied }: { b: BundleInfo; applied?: boolean }) {
  const Icon = iconOfBundle(b)
  return (
    <div className="group/card relative flex min-w-0 flex-col">
      <button type="button" onClick={() => openDetail(`bundle/${b.id}`)} data-bundle={b.id} data-keyrow aria-label={`${b.name}: preview`}
        className="glass flex min-w-0 flex-1 cursor-pointer flex-col rounded-[12px] text-left ring-primary/60 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none">
        <Thumb b={b} />
        <div className="flex min-w-0 flex-1 flex-col p-3.5 pt-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-muted" style={{ color: tintOfBundle(b) }}>
              <Icon className="size-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{b.name}</span>
            {applied && <span className="shrink-0 rounded-[5px] bg-primary/12 px-1.5 text-[11px] leading-[18px] font-medium text-primary" data-tip="The last bundle applied">Applied</span>}
          </div>
          {(!!b.code.length || !!b.problems.length) && (
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[12px]">
              {!!b.code.length && <span className="font-medium text-[var(--red)]">Runs code</span>}
              {!!b.problems.length && <span className="text-[var(--red)]" data-tip={b.problems.join("\n")}>Can't be read</span>}
            </div>
          )}
        </div>
      </button>
      {b.source === "vault" && (
        <button type="button" aria-label={`${b.name}: more`} data-tip="More" onClick={(e) => menuBelow(e, [
          { label: "Export…", icon: Download, run: () => { exportBundle(b).catch((er) => notifyError(er, "Couldn't export it")) } },
          { label: "Delete", icon: Trash2, danger: true, run: () => { void removeBundle(b) } },
        ])}
          className="absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-[7px] bg-background/80 text-muted-foreground opacity-0 backdrop-blur group-hover/card:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100">
          <MoreHorizontal className="size-4" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

/** Delete one of the user's bundles (to the trash), with Undo: its export, imported again. */
async function removeBundle(b: BundleInfo) {
  try {
    const copy = await bundleText(b).catch(() => null)
    await deleteBundle(b)
    if (copy) notify(`Deleted ${b.name}`, { action: { label: "Undo", run: () => importBundle(new File([copy], `${b.id}.bundle.json`)) } })
  } catch (e) { notifyError(e, "Couldn't delete it") }
}

/** A dashed card that does something (save, import). */
function ActionCard({ icon: Icon, title, onClick, ...rest }: { icon: LucideIcon; title: string; onClick: () => void } & Record<`data-${string}`, unknown>) {
  return (
    <button type="button" onClick={onClick} data-keyrow {...rest}
      className="flex min-h-[96px] min-w-0 cursor-pointer flex-col items-start justify-end gap-1 rounded-[12px] border-[1.5px] border-dashed border-border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-foreground/[0.02]">
      <Icon className="mb-auto size-5 text-muted-foreground" strokeWidth={2} />
      <span className="text-[15px] font-semibold">{title}</span>
    </button>
  )
}

/** The built-in grid's last card: the other bundles' icons, and More…, which opens them in a sheet. */
function MoreCard({ more }: { more: BundleInfo[] }) {
  return (
    <button type="button" onClick={() => openDetail("bundles-more")} data-bundles-more data-keyrow aria-label="More bundles"
      className="glass flex min-h-[96px] min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-[12px] p-3.5 text-left ring-primary/60 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none">
      <span aria-hidden className="flex gap-1.5">
        {more.map((b) => {
          const Icon = iconOfBundle(b)
          return <span key={b.id} className="grid size-7 place-items-center rounded-[7px] bg-muted" style={{ color: tintOfBundle(b) }}><Icon className="size-4" strokeWidth={2.25} /></span>
        })}
      </span>
      <span className="text-[15px] font-semibold">More…</span>
    </button>
  )
}

/** The app's other bundles (bundle.json's `more`), as a sheet: the built-in grid's More…. */
export function MoreBundles() {
  const l = useBundles()
  const more = l?.bundles.filter((b) => b.source === "app" && b.more) ?? []
  return (
    <>
      <SheetHead icon={Package} tint="var(--primary)" kicker="Bundles" title="More bundles" />
      <div className="@container" data-keylist>
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2" data-bundles-app-more>
          {more.map((b) => <BundleCard key={b.id} b={b} />)}
        </div>
      </div>
    </>
  )
}

export function Bundles({ store }: { store: Store }) {
  const l = useBundles()
  const file = useRef<HTMLInputElement>(null)
  const prev = store.bundles?.previous ?? null
  const welcome = !!store.bundles?.onboarding
  // The list follows the vault (a bundle saved or imported by an AI, from another device).
  const files = store.files
  useEffect(() => { void refreshBundles() }, [files])
  const app = l?.bundles.filter((b) => b.source === "app" && !b.more) ?? []
  const more = l?.bundles.filter((b) => b.source === "app" && b.more) ?? []
  const mine = l?.bundles.filter((b) => b.source === "vault") ?? []
  const pick = async (f: File | undefined) => {
    if (!f) return
    try {
      const b = await importBundle(f)
      notify(`Imported ${b.name}`, { action: { label: "Preview", run: () => openDetail(`bundle/${b.id}`) } })
    } catch (e) { notifyError(e, "Couldn't import it") }
  }
  return (
    <>
      <PageHeader title={welcome ? "Welcome to Vaultite" : "Bundles"} subtitle={welcome ? "Pick a setup to start from. You can change all of it later." : undefined}>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {welcome && <button type="button" className={secondary} onClick={() => skipOnboarding().catch((e) => notifyError(e))} data-bundles-skip>Start with Minimal</button>}
          <button type="button" className={welcome ? secondary : primary} onClick={() => openDetail("bundle-save")} data-bundles-save><Plus className="size-4" strokeWidth={2.25} />Save current setup</button>
        </div>
      </PageHeader>
      {prev && (
        <div className="glass mb-5 flex items-center gap-3 rounded-[12px] px-4 py-3" data-bundles-previous>
          <History className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">Applied {prev.name} {ago(prev.at)}</div>
          </div>
          <button type="button" className={secondary} onClick={() => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it"))}>Restore previous setup</button>
        </div>
      )}
      <div className="@container" data-keylist>
        <h2 className="mb-2 text-[17px] font-semibold">Built in</h2>
        {/* The applied one stays in sight even when it's one of More's. */}
        <div className="mb-7 grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3" data-bundles-app>
          {[...app, ...more.filter((b) => prev?.bundle === b.id)].map((b) => <BundleCard key={b.id} b={b} applied={prev?.bundle === b.id} />)}
          {!!more.length && <MoreCard more={more} />}
        </div>
        <h2 className="mb-2 text-[17px] font-semibold">Yours</h2>
        <div className="mb-6 grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3" data-bundles-mine>
          {mine.map((b) => <BundleCard key={b.id} b={b} applied={prev?.bundle === b.id} />)}
          {!mine.length && <ActionCard icon={Plus} title="Save current setup" onClick={() => openDetail("bundle-save")} />}
          <ActionCard icon={Import} title="Import a bundle" onClick={() => file.current?.click()} data-bundles-import />
        </div>
      </div>
      <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
    </>
  )
}

// ---------- a bundle's preview: what applying it changes here ----------

type Preview = Awaited<ReturnType<typeof previewOf>> & { pages?: Record<string, { icon: string | null; tint: string | null; plugin: string | null }> }

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

/** What applying a bundle changes here, then Apply. */
export function BundlePreview({ id }: { id: string }) {
  const [p, setP] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { previewOf(id).then((x) => setP(x as Preview), (e) => setError(String(e?.message ?? e))) }, [id])
  if (error) return <SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title="Can't open this bundle" sub={error} />
  if (!p) return <SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title="Loading…" />
  const { bundle: b, plan } = p
  const Icon = iconOfBundle(b)
  const code = runsCode(plan)
  const apply = async () => {
    if (code && !(await confirmDialog({
      title: `Run code from ${b.name}?`,
      body: `It brings vault plugins (${plan.code.map((c) => c.name).join(", ")}). They run on the machine that serves this app, with your files and permissions. Apply bundles that run code only from people you trust.`,
      confirm: "Apply and run them", danger: true,
    }))) return
    setBusy(true)
    try {
      closeDetail()
      await applyBundle(b, plan, code)
    } catch (e) { notifyError(e, `Couldn't apply ${b.name}`) } finally { setBusy(false) }
  }
  const pins = plan.pins
  return (
    <div data-bundle-preview={b.id}>
      <SheetHead icon={Icon} tint={tintOfBundle(b)} kicker={b.source === "app" ? "Built-in bundle" : "Your bundle"} title={b.name} sub={b.description || undefined} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={busy || plan.empty || !!b.problems.length} onClick={apply} data-bundle-apply>
          {plan.empty ? "This is your setup already" : <>Apply {b.name}<ArrowRight className="size-4" strokeWidth={2.25} /></>}
        </button>
        {b.source === "vault" && <button type="button" className={secondary} onClick={() => exportBundle(b).catch((e) => notifyError(e, "Couldn't export it"))}><Download className="size-4" strokeWidth={2} />Export</button>}
        {b.source === "vault" && <button type="button" className={secondary} onClick={() => { closeDetail(); void removeBundle(b) }}><Trash2 className="size-4" strokeWidth={2} />Delete</button>}
      </div>
      {code && (
        <div className="mb-4 flex gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--red)_10%,transparent)] p-3.5" data-bundle-code>
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--red)]" strokeWidth={2} />
          <div className="text-[14px] leading-[20px]">
            <div className="font-semibold">It runs code on this machine</div>
            <div className="text-muted-foreground">It brings vault plugins: {plan.code.map((c) => c.name + (c.kept ? " (you have one by that name: yours stays)" : "")).join(", ")}. Applying asks you first.</div>
          </div>
        </div>
      )}
      {!!b.problems.length && <p className="mb-4 text-[14px] text-[var(--red)]">{b.problems.join(". ")}</p>}
      <div className="grid grid-cols-1 gap-3">
        {(plan.plugins.on.length > 0 || plan.plugins.off.length > 0 || plan.plugins.missing.length > 0) && (
          <Panel title="Plugins" icon={Puzzle}>
            {!!plan.plugins.on.length && <Group title="Turns on" count={plan.plugins.on.length}><div className="flex flex-wrap gap-1.5">{plan.plugins.on.map((x) => <Chip key={x} id={x} />)}</div></Group>}
            {!!plan.plugins.off.length && <Group title="Turns off" count={plan.plugins.off.length}><div className="flex flex-wrap gap-1.5">{plan.plugins.off.map((x) => <Chip key={x} id={x} off />)}</div></Group>}
            {!!plan.plugins.missing.length && <Group title="Not in this app (skipped)"><p className="text-[13px] text-muted-foreground">{plan.plugins.missing.join(", ")}</p></Group>}
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
        {plan.appearance.length > 0 && (
          <Panel title="Look" icon={Settings2}>
            {(() => {
              const scheme = plan.appearance.find((c) => c.key === "scheme")?.to as string | undefined
              const theme = plan.appearance.find((c) => c.key === "theme")?.to as string | undefined
              return scheme ? <Swatches id={scheme} mode={theme === "dark" || theme === "light" ? theme : undefined} className="mb-2 h-12 max-w-[280px]" /> : null
            })()}
            {plan.appearance.map((c) => <Setting key={c.key} label={APPEARANCE[c.key] ?? c.key} from={c.from} to={c.to} />)}
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
    </div>
  )
}

const APPEARANCE: Record<string, string> = {
  theme: "Theme", scheme: "Colour scheme", density: "Density", fileIcons: "File icons", tabBar: "Tab bar", lineNumbers: "Line numbers", statusBar: "Status bar", sidebarScroll: "Sidebar scrolling",
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
  const [hotkeys, setHotkeys] = useState(false)
  const [code, setCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const l = useBundles()
  const prefs = usePrefs()
  const vaultOn = usePlugins().filter((x) => x.tier === "vault" && switchedOn(x, prefs)).length
  const clash = l?.bundles.find((b) => b.source === "vault" && b.name.toLowerCase() === name.trim().toLowerCase())
  useSheetGuard(() => [name.trim() && `Name: ${name.trim()}`, description.trim() && `Description: ${description.trim()}`].filter((x) => !!x))
  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const b = await saveBundle({ name, description, hotkeys, vaultPlugins: code, replace: !!clash })
      closeDetail()
      notify(`Saved ${b.name}`, { action: { label: "Export", run: () => exportBundle(b) } })
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
            <div className="flex min-h-12 items-center gap-3 py-2">
              <div className="min-w-0 flex-1"><div className="text-[15px]">Hotkeys</div><div className="text-[13px] text-muted-foreground">Your keyboard shortcuts, from hotkeys.json</div></div>
              <Switch on={hotkeys} onChange={setHotkeys} label="Include hotkeys" />
            </div>
            {vaultOn > 0 && (
              <div className="flex min-h-12 items-center gap-3 py-2">
                <div className="min-w-0 flex-1"><div className="text-[15px]">Your vault plugins</div><div className="text-[13px] text-muted-foreground">{vaultOn} on. They run code: whoever applies the bundle is asked first</div></div>
                <Switch on={code} onChange={setCode} label="Include vault plugins" />
              </div>
            )}
          </div>
        </Panel>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          It keeps which plugins are on, their settings that differ from the defaults (not who may reach this machine), the sidebars and pinned
          pages{currentWorkspace() ? " (this workspace's)" : ""}, the dashboards they need and the look. Not your notes.
        </p>
        <div><button type="submit" className={primary} disabled={busy || !name.trim()} data-bundle-save>{clash ? "Replace" : "Save"}</button></div>
      </div>
    </form>
  )
}
