// Bundles beside the layout picker: Get's layouts and packs, a new vault's welcome, and the sheets: a bundle's preview
// (what applying it changes, asking first when it runs code), an import's, sharing one. Format: core/bundles.ts.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import {
  ArrowRight, BookOpen, Bot, Check, Copy, Download, FilePlus, Import, LayoutDashboard, MoreHorizontal, Package, PackagePlus, PanelLeft, PanelRight, Pin, Plus,
  Puzzle, RefreshCw, Settings2, Share, ShieldAlert, Star, Trash2, type LucideIcon,
} from "lucide-react"
import type { Store } from "@/core/data"
import {
  addIncoming, agentPrompt, applyBundle, browseBundles, bundleText, exportBundle, forkBundle, givenImport, incomingOf, isBundleText, isLayout,
  lockedBy, openImport, previewOf, removeBundle, runsCode, shareOf, skipOf, skipOnboarding, useBundles, useListedPicture, usePicture, without,
  type BundleInfo, type Directory, type Incoming, type Listed, type Plan, type ShareItem,
} from "@/core/bundles"
import { AND, APPEARANCE, EDITOR_LABELS, EDITOR_NAMES, EDITOR_VALUES, NEWTAB, OPENS, stem } from "@/core/bundlenames"
import { copyText } from "@/core/richmd"
import { closeDetail, openDetail, replaceDetail } from "@/core/nav"
import { errorText, notify, notifyError } from "@/core/notify"
import { namedIcon, tintOf } from "@/core/pages"
import { pluginById, tintOfPlugin } from "@/core/plugins"
import { useKeptCount } from "@/core/heights"
import { closeTab } from "@/core/workspace"
import { menuBelow } from "@/components/ContextMenu"
import { useSheetGuard } from "@/components/DetailSheet"
import { Bar as Line, Panel, PageHeader, SheetHead, Switch } from "@/components/kit"
import { Swatches } from "@/components/Appearance"
import { askToRun, LayoutPicker } from "@/components/LayoutPicker"
import { LayoutDrawing } from "@/components/LayoutDrawings"
import { cn } from "@/lib/utils"
import { Button } from "@/components/Button"
import { BundleLink } from "./BundleLink"

const iconOfBundle = (b: Pick<BundleInfo, "icon">) => namedIcon(b.icon) ?? Package
const tintOfBundle = (b: Pick<BundleInfo, "tint">) => tintOf(b.tint) ?? "var(--primary)"

/** Where a bundle came from, without the commit an import from the directory pinned. */
const place = (from: string) => from.replace(/@[0-9a-f]{40}$/, "")

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

// ---------- Get's layouts and packs: the directory's bundles ----------

const CARD = "glass flex min-w-0 flex-1 cursor-pointer flex-col rounded-[12px] text-left ring-primary/60 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none"
// Two across on a phone, three or four as they fit.
const GRID = "grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4"

const Picture = ({ src, onError }: { src: string; onError?: () => void }) =>
  <img src={src} alt="" draggable={false} onError={onError} className="aspect-[16/10] w-full rounded-t-[11px] border-b-[0.5px] border-border bg-background object-cover object-top-left" />

/** What a shared bundle is, as its card says it. */
const KIND: Record<NonNullable<Listed["kind"]>, string> = { layout: "Layout", pack: "Pack", look: "Look" }

/** What a listed bundle's card draws without its picture: a layout that says nothing but its name, drawn plain. */
const plainOf = (e: Listed): BundleInfo => ({ id: e.address, source: "vault", name: e.name, description: e.description, icon: e.icon ?? "package", tint: e.tint ?? "",
  author: e.author, sort: 0, theme: null, scheme: null, density: null, on: null, pinned: null, panels: null, shape: { tabBar: null, rails: null, floating: null }, home: null,
  code: [], official: true, from: e.address, guide: null, hotkeys: false, preview: null, previewDark: null, problems: [], kind: e.kind ?? "layout", tweaked: false })

/** A bundle the directory lists, as a card: who made it and its stars under its name, and whether the user has it.
 *  Opening it is its import preview, pinned at the commit listed (an update says what changed). */
function ListedCard({ e }: { e: Listed }) {
  const src = useListedPicture(e)
  const [broken, setBroken] = useState(false)
  const b = plainOf(e), Icon = iconOfBundle(b)
  return (
    <button type="button" onClick={() => openImport(e.address)} data-listed={e.source} data-keyrow className={cn(CARD, "relative")}>
      {src && !broken ? <Picture src={src} onError={() => setBroken(true)} />
        : <span className="block aspect-[16/10] w-full overflow-hidden rounded-t-[11px] border-b-[0.5px] border-border"><LayoutDrawing b={b} className="block size-full" /></span>}
      {/* (over its picture, where a narrow card's name and author keep their room) */}
      {e.imported && (
        <span className={cn("absolute top-2 right-2 rounded-[6px] bg-background/85 px-1.5 text-[11px] leading-[20px] font-medium shadow-[0_0_0_0.5px_var(--border)] backdrop-blur",
          e.current ? "text-muted-foreground" : "text-primary")} {...(e.current ? { "data-listed-imported": true } : { "data-listed-update": true })}>
          {e.current ? "Imported" : "Update available"}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-3.5 pt-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-muted" style={{ color: tintOfBundle(b) }}>
            <Icon className="size-4" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{e.name}</span>
          {e.runsCode && <span className="shrink-0 text-[var(--red)]" data-bundle-runs-code data-tip={`Runs code${e.installs.length ? `: installs ${AND.format(e.installs.map((x) => x.name))}` : ""}`}><ShieldAlert className="size-4" strokeWidth={2} /></span>}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-9 text-[13px] text-muted-foreground">
          {e.kind && <><span className="shrink-0" data-listed-kind={e.kind}>{KIND[e.kind]}</span><span aria-hidden>·</span></>}
          <span className="min-w-0 truncate">{e.author}</span>
          {e.stars > 0 && <><span aria-hidden>·</span><Star className="size-3 shrink-0" strokeWidth={2.25} /><span className="tabular-nums" aria-label={`${e.stars} stars`}>{e.stars}</span></>}
        </div>
      </div>
    </button>
  )
}

/** Get's layouts and packs: the directory's bundles (shared on GitHub), by Get's search, and Import for one someone
 *  sent (also by pasting it, or dropping its file, anywhere on the page). Unreachable, one quiet line says so. */
export function StoreBundles({ query: q }: { query: string }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [failed, setFailed] = useState(false)
  // (fetched again when the user's imports change: which are theirs, and current)
  const mine = useBundles()?.bundles.filter((b) => b.from).map((b) => `${b.id} ${b.from}`).join("\n")
  useEffect(() => {
    let live = true
    const t = setTimeout(() => browseBundles(q).then((d) => { if (live) { setDir(d); setFailed(false) } }, () => { if (live) setFailed(true) }), q ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [q, mine])
  const root = useRef<HTMLDivElement>(null)
  const over = useImportGestures(root)
  const list = dir?.bundles ?? []
  const cards = useKeptCount(q.trim() ? null : "bundles:browse", dir?.available ? list.length : undefined, 3, 9)
  return (
    <section ref={root} className="relative mb-6 @container" data-file-drop data-bundles-browse>
      <div className="mb-1.5 flex min-h-7 items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground md:text-[12px]">Layouts and packs</h2>
        <button type="button" onClick={() => openDetail("bundle-import")} data-bundles-import data-tip="A bundle someone sent: paste it or drop its file here too"
          className="-my-1 -mr-1 flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] text-primary hover:bg-foreground/[0.05] max-md:h-11 max-md:text-[15px]">
          <Import className="size-3.5 max-md:size-4" strokeWidth={2.25} />Import…
        </button>
      </div>
      {!dir && !failed ? <CardSkeletons count={cards} />
        : failed || (dir && !dir.available)
        ? <p className="px-1 text-[14px] text-muted-foreground" data-bundles-browse-off>The directory of shared layouts and packs can't be reached right now.</p>
        : dir && !list.length ? <p className="px-1 text-[14px] text-muted-foreground" data-bundles-browse-none>{q.trim() ? "No shared layouts or packs match." : "No layouts or packs are shared yet."}</p>
        : <div className={GRID} data-keylist data-bundles-listed>{list.map((e) => <ListedCard key={e.address} e={e} />)}</div>}
      {over && (
        <div className="pointer-events-none absolute -inset-2 grid place-items-center rounded-[14px] border-2 border-dashed border-primary/60 bg-background/85 text-[15px] font-medium" data-bundles-drop>
          Drop to import the bundle
        </div>
      )}
    </section>
  )
}

/** The directory on its way: ListedCard's shape, its picture a muted block and its lines bars. */
function CardSkeletons({ count }: { count: number }) {
  return (
    <div className={cn(GRID, "loading-in")} aria-busy data-bundles-loading>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(CARD, "cursor-default hover:ring-0")}>
          <div className="skeleton aspect-[16/10] w-full rounded-none rounded-t-[11px]" />
          <div className="flex min-w-0 flex-1 flex-col p-3.5 pt-3">
            <div className="flex items-center gap-2">
              <span className="size-7 shrink-0 rounded-[7px] bg-muted" />
              <span className="min-w-0 flex-1 text-[15px] leading-[20px]"><Line w={i % 2 ? "45%" : "58%"} /></span>
            </div>
            <div className="mt-1 pl-9 text-[13px] leading-[18px]"><Line w={i % 2 ? "32%" : "40%"} /></div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- a new vault's welcome ----------

/** A vault opened for the first time: its layout to start from, applied as it's picked (Standard until then), then
 *  Continue. `at`: the tab it's in, closed after. */
export function Welcome({ store, at }: { store: Store; at?: string }) {
  const finish = async () => {
    try { if (store.bundles?.onboarding) await skipOnboarding() } catch (e) { notifyError(e, "Couldn't start"); return }
    if (at) closeTab(at)
  }
  return (
    <div className="mx-auto max-w-[560px] pt-[6vh]" data-bundles-welcome>
      <PageHeader title="Welcome to Vaultite" subtitle="Pick a layout to start from. It changes as you click, and Settings has it again, with the rest of your look." />
      <LayoutPicker builtInOnly menus={false} open="none" className="mb-6" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button look="primary" onClick={() => void finish()} data-bundles-continue>Continue<ArrowRight className="size-4" strokeWidth={2.25} /></Button>
        {/* (like a phone's setup offering to restore from a backup: there, not in the way) */}
        <p className="text-[14px] text-muted-foreground" data-bundles-welcome-import>
          Have a bundle? <button type="button" onClick={() => openDetail("bundle-import")} className="cursor-pointer font-medium text-primary hover:underline">Import it</button>
        </p>
      </div>
    </div>
  )
}

// ---------- a bundle's preview: what applying it changes here ----------

/** `file`: an import's export (its pictures are in it). */
type Preview = { bundle: BundleInfo; plan: Plan; pages?: Record<string, { icon: string | null; tint: string | null; plugin: string | null }>; file?: unknown }

const showValue = (v: unknown) => (v === null || v === undefined ? "default" : typeof v === "boolean" ? (v ? "on" : "off") : Array.isArray(v) ? v.join(", ") || "none" : String(v))

/** Which of a plan's changes the preview leaves out (unticked), and those that go with one left out (`locked`: a plugin
 *  whose install is). Absent: the plan as it is, nothing to tick (an import's preview). */
type Picks = { off: ReadonlySet<string>; locked: ReadonlySet<string>; toggle: (id: string) => void }

/** A tick before a change: quiet when off, the accent's when on. */
const Tick = ({ on, className }: { on: boolean; className?: string }) => (
  <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-[4.5px] transition-colors max-md:size-5 max-md:rounded-[6px]", className,
    on ? "bg-primary text-primary-foreground" : "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_30%,transparent)]")}>
    {on && <Check className="size-3 max-md:size-3.5" strokeWidth={3.25} />}
  </span>
)

/** A change, led by its tick (unticked: dimmed). Without an `id`, a line going with change `rides` (a pin's page) or
 *  none: no tick, dimmed with it. `block`: more than text (the sidebars), its tick at the top. */
function ChangeLine({ pick, id, rides, block, className, children, ...data }: {
  pick?: Picks; id?: string; rides?: string; block?: boolean; className?: string; children: ReactNode; [data: `data-${string}`]: string | boolean | undefined
}) {
  const body = (dim: boolean) => <div className={cn("min-w-0 flex-1 transition-opacity", block ? "flex flex-col gap-2" : "flex items-center gap-2", dim && "opacity-45")}>{children}</div>
  if (!pick || !id) {
    const dim = !!pick && !!rides && (pick.off.has(rides) || pick.locked.has(rides))
    return <div className={cn("flex min-w-0 gap-2.5", block ? "items-start" : "items-center", className)} {...data}>{pick && <span className="w-4 shrink-0 max-md:w-5" />}{body(dim)}</div>
  }
  const locked = pick.locked.has(id), on = !locked && !pick.off.has(id)
  const toggle = () => { if (!locked) pick.toggle(id) }
  return (
    <div role="checkbox" aria-checked={on} aria-disabled={locked || undefined} tabIndex={0} data-change={id} {...data}
      onClick={toggle} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle() } }}
      className={cn("-mx-1.5 flex min-w-0 gap-2.5 rounded-[7px] px-1.5 select-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none max-md:min-h-11",
        block ? "items-start py-1.5" : "items-center", locked ? "cursor-default" : "cursor-pointer hover:bg-foreground/[0.04]", className)}>
      <Tick on={on} className={block ? "mt-0.5" : undefined} />
      {body(!on)}
    </div>
  )
}

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground">{title}{count !== undefined && <span className="ml-1 font-normal">{count}</span>}</div>
      {children}
    </div>
  )
}

/** Lines two across where they fit (plugins, short and many). */
const Lines = ({ children, ...rest }: { children: ReactNode; [data: `data-${string}`]: string | boolean | undefined }) =>
  <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2" {...rest}>{children}</div>

/** A plugin a plan turns on or off (`off`: drawn quiet), or one of the user's it leaves alone. */
function PluginLine({ id, name, off, pick }: { id: string; name: string; off?: boolean; pick?: Picks }) {
  const Icon = pluginById(id)?.icon ?? Puzzle
  return (
    <ChangeLine pick={pick} id={pick && `plugin:${id}`} className="min-h-8 text-[14px]">
      <Icon className="size-4 shrink-0" strokeWidth={2} style={{ color: off ? "var(--muted-foreground)" : tintOfPlugin(id) }} />
      <span className={cn("min-w-0 truncate", off && "text-muted-foreground")}>{name}</span>
    </ChangeLine>
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

/** A pinned page's icon and name (`off`: one it unpins), and whether it's newly pinned or the user's own. */
function PageText({ path, look, state }: { path: string; look?: { icon: string | null; tint: string | null; plugin: string | null }; state?: "new" | "kept" | "off" }) {
  const Icon = namedIcon(look?.icon) ?? (look?.plugin ? pluginById(look.plugin)?.icon : null) ?? LayoutDashboard
  return <>
    <Icon className={cn("size-4 shrink-0", state === "off" && "opacity-60")} strokeWidth={2} style={{ color: state === "off" ? undefined : tintOf(look?.tint) ?? (look?.plugin ? tintOfPlugin(look.plugin) : "var(--muted-foreground)") }} />
    <span className={cn("min-w-0 flex-1 truncate", state === "off" && "text-muted-foreground line-through decoration-foreground/30")}>{stem(path)}</span>
    {state === "new" && <span className="rounded-[5px] bg-primary/12 px-1.5 text-[11px] leading-[18px] font-medium text-primary">pinned</span>}
    {state === "kept" && <span className="text-[12px] text-muted-foreground">yours</span>}
  </>
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x))

/** What applying a bundle changes here, each change ticked: Apply or Try it, without those unticked (then Save as
 *  "My <Name>" keeps it so). A layout tile's Details; the one in use, changed, previewed clean (what Reset puts back). */
export function BundlePreview({ id }: { id: string }) {
  const [p, setP] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offAdded, setOffAdded] = useState(false)
  const [edits, setEdits] = useState<ReadonlySet<string> | null>(null)
  const l = useBundles()
  // (the one in use, changed: what Revert, applying it clean, puts back)
  const drift = !!l?.bundles.find((x) => x.id === id)?.modified
  useEffect(() => { previewOf(id, drift).then((x) => setP(x as Preview), (e) => setError(errorText(e))) }, [id, drift])
  if (error) return <SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title="Can't open this bundle" sub={error} />
  if (!p) return <div aria-busy><SheetHead icon={Package} tint="var(--muted-foreground)" kicker="Bundle" title={<Line w="45%" />} sub={<Line w="70%" />} /></div>
  const { bundle: b, plan } = p
  const listed = l?.bundles.find((x) => x.id === b.id)
  // The bundle applied last starts without what it was applied without: applying it is reverting to it.
  const base = new Set((listed?.applied?.skip ?? []).filter((x) => plan.changes.some((c) => c.id === x)))
  const off = edits ?? base
  const pick: Picks = { off, locked: lockedBy(plan, off), toggle: (x) => setEdits(new Set(off.has(x) ? [...off].filter((y) => y !== x) : [...off, x])) }
  const skip = skipOf(plan, off), chosen = without(plan, new Set(skip))
  const edited = !sameSet(off, base), left = plan.changes.length - skip.length
  const code = runsCode(chosen)
  const nothing = !left && !offAdded
  const act = async (what: () => Promise<unknown>, failed: string) => {
    setBusy(true)
    try { await what() } catch (e) { notifyError(e, failed) } finally { setBusy(false) }
  }
  const apply = async (trial: boolean) => {
    if (code && !(await askToRun(b, chosen, trial))) return
    await act(async () => { closeDetail(); await applyBundle(b, plan, { allowCode: code, offAdded, skip, trial, fresh: drift }) }, `Couldn't ${trial ? "try" : "apply"} ${b.name}`)
  }
  const fork = () => act(async () => { const n = await forkBundle(b, skip); replaceDetail(`bundle/${n.id}`); notify(`Saved ${n.name}`) }, "Couldn't save it")
  const mine = `My ${b.name}`
  return (
    <div data-bundle-preview={b.id}>
      <SheetHead icon={iconOfBundle(b)} tint={tintOfBundle(b)} kicker={b.from ? `From ${place(b.from)}` : b.kind === "pack" ? "Pack" : b.kind === "look" ? "Look" : b.source === "app" ? "Built-in layout" : "Your layout"} title={b.name} sub={b.description || undefined} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button look="primary" disabled={busy || nothing || !!b.problems.length} onClick={() => void apply(false)} data-bundle-apply>
          {nothing && !edited ? "This is your setup already" : edited ? "Apply" : <>Apply {b.name}<ArrowRight className="size-4" strokeWidth={2.25} /></>}
        </Button>
        {!(nothing && !edited) && <Button disabled={busy || nothing || !!b.problems.length} onClick={() => void apply(true)} data-bundle-try>Try</Button>}
        {edited && <Button disabled={busy || !!b.problems.length} onClick={() => void fork()} data-bundle-fork>Save as {mine}</Button>}
        {b.source === "vault" && !edited && (
          <Button aria-label="More" data-tip="More" className="px-2.5" data-bundle-more onClick={(e) => menuBelow(e, [
            { label: "Share…", icon: Share, run: () => openDetail(`bundle-share/${b.id}`) },
            { label: "Delete", icon: Trash2, danger: true, run: () => { closeDetail(); void removeBundle(b) } },
          ])}><MoreHorizontal className="size-4" strokeWidth={2.25} /></Button>
        )}
      </div>
      {skip.length > 0 && (
        <p className="-mt-3 mb-4 text-[13px] leading-[18px] text-muted-foreground" data-bundle-leaving>
          {edited ? `Leaving out ${skip.length} of its ${plan.changes.length} changes.` : `Leaving out ${skip.length === 1 ? "one change" : `${skip.length} changes`}, as when you applied it.`} <button type="button" onClick={() => setEdits(new Set())} className="cursor-pointer font-medium text-primary hover:underline" data-bundle-include-all>Include all</button>
        </p>
      )}
      <Changes p={p} pick={pick} offAdded={offAdded} setOffAdded={setOffAdded} />
    </div>
  )
}

/** A bundle given to the app (openImport), not added yet: what applying it changes, then Apply (added, then applied)
 *  or Add (an update says first what's new). Reloaded, what it was given is gone: the Import sheet instead. */
export function IncomingBundle({ id }: { id: string }) {
  const [source] = useState(() => givenImport(id))
  const [inc, setInc] = useState<Incoming | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offAdded, setOffAdded] = useState(false)
  const l = useBundles()
  useEffect(() => { if (source) incomingOf(source).then(setInc, (e) => setError(errorText(e))) }, [source])
  if (!source) return <ImportBundle />
  const repo = typeof source === "string" && !source.trim().startsWith("{") && !source.includes("\n") ? place(source.trim()) : null
  if (error) return (
    <div data-bundle-incoming-error>
      <SheetHead icon={Import} tint="var(--muted-foreground)" kicker="Import" title="Can't import this bundle" sub={error} />
      <Button onClick={() => replaceDetail("bundle-import")}>Import another…</Button>
    </div>
  )
  if (!inc) return <div aria-busy><SheetHead icon={Import} tint="var(--muted-foreground)" kicker={repo ? `Getting it from ${repo}` : "Import"} title={<Line w="45%" />} sub={<Line w="70%" />} /></div>
  const { bundle: b, plan } = inc
  const pack = !isLayout(b)
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
    await add((added) => applyBundle(added, plan, { allowCode: code, offAdded }))
  }
  const keep = () => add(async (added) => {
    if (replaces) notify(`Updated ${added.name}`)
    else notify(pack ? `Kept ${added.name} for later` : `Added ${added.name} to your layouts`, { action: { label: "Details", run: () => openDetail(`bundle/${added.id}`) } })
  })
  return (
    <div data-bundle-incoming={b.id}>
      <SheetHead icon={iconOfBundle(b)} tint={tintOfBundle(b)} kicker={b.from ? `From ${place(b.from)}` : "Import"} title={b.name} sub={b.description || undefined} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button look="primary" disabled={busy || !!b.problems.length} onClick={() => void apply()} data-bundle-incoming-apply>Apply {b.name}<ArrowRight className="size-4" strokeWidth={2.25} /></Button>
        <Button disabled={busy || !!b.problems.length} onClick={() => void keep()} data-bundle-incoming-add>{replaces ? <><RefreshCw className="size-4" strokeWidth={2.25} />Update {replaces.name}</> : <><Plus className="size-4" strokeWidth={2.25} />{pack ? "Keep for later" : "Add to your layouts"}</>}</Button>
      </div>
      <p className="-mt-2 mb-5 text-[13px] leading-[18px] text-muted-foreground">
        {replaces ? `It replaces your ${replaces.name}, from the same repository. ` : ""}{pack ? "Either way it's kept in this vault, to apply again or share." : "Either way it's kept with your layouts in Settings, Appearance, to pick again or share."}
      </p>
      {inc.changes && <Updated changes={inc.changes} name={replaces?.name ?? b.name} />}
      {plan.empty && <p className="mb-4 text-[14px] text-muted-foreground">Applying it changes nothing here: it's your setup already.</p>}
      <Changes p={inc} offAdded={offAdded} setOffAdded={setOffAdded} />
    </div>
  )
}

const short = (commit: string | null) => (commit ? commit.slice(0, 7) : "none")

/** What an update changes in the user's copy of a bundle: its files, and the plugins it installs pinned anew. */
function Updated({ changes: c, name }: { changes: NonNullable<Incoming["changes"]>; name: string }) {
  const files: [string, string][] = [...c.added.map((f): [string, string] => [f, "added"]), ...c.changed.map((f): [string, string] => [f, "changed"]), ...c.removed.map((f): [string, string] => [f, "removed"])]
  return (
    <div className="mb-3" data-bundle-update><Panel title={`What's new since your ${name}`} icon={RefreshCw}>
      {!files.length && !c.installs.length && <p className="text-[14px] text-muted-foreground">Nothing: it's the same as yours.</p>}
      {files.map(([f, how]) => (
        <div key={f} className="flex min-h-7 items-center gap-3 text-[14px]">
          <span className={cn("min-w-0 flex-1 truncate", how === "removed" && "text-muted-foreground line-through decoration-foreground/30")}>{f}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">{how}</span>
        </div>
      ))}
      {c.installs.map((x) => (
        <div key={x.id} className="flex min-h-7 items-center gap-3 text-[14px]">
          <PackagePlus className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">{x.name}</span>
          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{x.from && x.to ? `${short(x.from)} → ${short(x.to)}` : x.to ? "now installed" : "no longer installed"}</span>
        </div>
      ))}
    </Panel></div>
  )
}

/** A preview's body: what applying the bundle changes here (plugins, panels, pins, the look, settings, files), each
 *  change a line ticked when `pick` is given. */
function Changes({ p, pick, offAdded, setOffAdded }: { p: Preview; pick?: Picks; offAdded: boolean; setOffAdded: (v: boolean) => void }) {
  const { bundle: b, plan } = p
  const skip = new Set(pick ? skipOf(plan, pick.off) : [])
  const chosen = without(plan, skip)
  const code = runsCode(chosen)
  const pins = plan.pins
  const added = plan.plugins.added ?? []
  const picture = usePicture(b, p.file)
  const has = (id: string) => plan.changes.some((c) => c.id === id)
  const installs = plan.code.filter((c) => c.change)
  const nameOf = (id: string) => pluginById(id)?.name ?? plan.code.find((c) => c.id === id)?.name ?? id
  // (a vault plugin's own files go with its install, said once there)
  const files = plan.files.add.filter((f) => !f.startsWith(".vaultite/plugins/"))
  return (
    <>
      {b.on !== null && <p className="-mt-2 mb-4 text-[13px] leading-[18px] text-muted-foreground" data-bundle-reach>Applies to every window and device on this vault; agents lose the tools of plugins it turns off.</p>}
      {code && (
        <div className="mb-4 flex gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--red)_10%,transparent)] p-3.5" data-bundle-code>
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--red)]" strokeWidth={2} />
          <div className="text-[14px] leading-[20px]">
            <div className="font-semibold">It runs code on this machine</div>
            <div className="text-muted-foreground">It brings vault plugins: {chosen.code.map((c) => c.name + (c.kept ? " (you have one by that name: yours stays)" : c.source ? ` (installed from ${c.source})` : "")).join(", ")}. Applying asks you first.</div>
          </div>
        </div>
      )}
      {!!b.problems.length && <p className="mb-4 text-[14px] text-ink-(--red)">{b.problems.join(". ")}</p>}
      {picture && <img src={picture} alt={`${b.name}, as it looks`} className="mb-4 w-full rounded-[12px] border-[0.5px] border-border" data-bundle-picture />}
      <div className="grid grid-cols-1 gap-3">
        {(installs.length > 0 || plan.plugins.on.length > 0 || plan.plugins.off.length > 0 || plan.plugins.missing.length > 0 || added.length > 0) && (
          <Panel title="Plugins" icon={Puzzle}>
            {!!installs.length && (
              <Group title="Installs" count={installs.length}>
                {installs.map((c) => (
                  <ChangeLine key={c.id} pick={pick} id={c.change} className="min-h-8 text-[14px]">
                    <PackagePlus className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                    <span className="shrink-0">{c.name}</span>
                    <span className="min-w-0 truncate text-[13px] text-muted-foreground">{c.source ? `from ${c.source}` : "its own code"}</span>
                  </ChangeLine>
                ))}
              </Group>
            )}
            {!!plan.plugins.on.length && <Group title="Turns on" count={plan.plugins.on.length}><Lines>{plan.plugins.on.map((x) => <PluginLine key={x} id={x} name={nameOf(x)} pick={pick} />)}</Lines></Group>}
            {!!plan.plugins.off.length && <Group title="Turns off" count={plan.plugins.off.length}><Lines>{plan.plugins.off.map((x) => <PluginLine key={x} id={x} name={nameOf(x)} pick={pick} off />)}</Lines></Group>}
            {!!plan.plugins.missing.length && <Group title="Not in this app (skipped)"><p className="text-[13px] text-muted-foreground">{plan.plugins.missing.join(", ")}</p></Group>}
            {!!added.length && (
              <Group title={offAdded ? "Plugins you added: turned off too" : "Plugins you added stay as they are"} count={added.length}>
                <Lines data-bundle-added>{added.map((x) => <PluginLine key={x} id={x} name={nameOf(x)} off={offAdded} />)}</Lines>
                <div className="mt-2 flex min-h-10 items-center gap-3">
                  <span className="min-w-0 flex-1 text-[14px]">Turn those off too<span className="block text-[13px] text-muted-foreground">Undo turns them back on</span></span>
                  <Switch on={offAdded} onChange={setOffAdded} label="Turn the plugins you added off too" />
                </div>
              </Group>
            )}
          </Panel>
        )}
        {plan.panels.setup && plan.panels.changed && (
          <Panel title="Sidebars" icon={PanelLeft}>
            <ChangeLine pick={pick} id={has("panels") ? "panels" : undefined} block>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Side side="Left" keys={plan.panels.setup.left} collapsed={plan.panels.setup.collapsed} />
                <Side side="Right" keys={plan.panels.setup.right} collapsed={plan.panels.setup.collapsed} />
              </div>
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                The default panels, and this workspace's{plan.panels.workspace ? " (its own panels are replaced)" : ""}. Your other workspaces keep theirs.
              </p>
            </ChangeLine>
          </Panel>
        )}
        {pins && (pins.pin.length > 0 || pins.unpin.length > 0 || pins.list.length > 0) && (
          <Panel title="Pinned pages" icon={Pin}>
            {!pins.list.length && <p className="text-[14px] text-muted-foreground">None</p>}
            {pins.list.map((x) => (
              <ChangeLine key={x} pick={pick} id={has(`pin:${x}`) ? `pin:${x}` : undefined} className="min-h-8 text-[14px]">
                <PageText path={x} look={p.pages?.[x]} state={pins.want.includes(x) ? (pins.pin.includes(x) ? "new" : undefined) : "kept"} />
              </ChangeLine>
            ))}
            {has("pins:order") && <ChangeLine pick={pick} id="pins:order" className="min-h-8 text-[14px]"><span className="min-w-0 truncate text-muted-foreground">In the bundle's order</span></ChangeLine>}
            {!!pins.unpin.length && (
              <div className="mt-2 border-t-[0.5px] border-border pt-2">
                <div className="mb-0.5 text-[12px] font-semibold tracking-wide text-muted-foreground">Unpinned (the files stay)</div>
                {pins.unpin.map((x) => (
                  <ChangeLine key={x} pick={pick} id={has(`pin:${x}`) ? `pin:${x}` : undefined} className="min-h-8 text-[14px]">
                    <PageText path={x} look={p.pages?.[x]} state="off" />
                  </ChangeLine>
                ))}
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
            {plan.appearance.map((c) => <Setting key={c.key} pick={pick} id={c.change} label={APPEARANCE[c.key] ?? c.key} from={c.from} to={c.to} />)}
            {plan.newtab.map((c) => <Setting key={`newtab.${c.key}`} pick={pick} id={c.change} label={NEWTAB[c.key] ?? `New tab: ${c.key}`} from={c.key === "page" && typeof c.from === "string" ? stem(c.from) : c.from}
              to={c.key === "page" && typeof c.to === "string" ? stem(c.to) : c.to} labels={c.key === "opens" ? OPENS : undefined} />)}
          </Panel>
        )}
        {(plan.editor.length > 0 || plan.settings.length > 0 || plan.hotkeys.length > 0 || plan.skipped.length > 0) && (
          <Panel title="Settings" icon={Settings2}>
            {/* (a key it takes out is the default again: said by its value) */}
            {plan.editor.map((c) => <Setting key={`editor.${c.key}`} pick={pick} id={c.change} label={EDITOR_NAMES[c.key] ?? c.key} from={c.from ?? EDITOR_VALUES[c.key]}
              to={c.to ?? EDITOR_VALUES[c.key]} labels={EDITOR_LABELS[c.key]} />)}
            {plan.settings.map((s) => {
              const pl = pluginById(s.plugin)
              const decl = pl?.settingsDecls?.[s.key]
              return <Setting key={`${s.plugin}.${s.key}`} pick={pick} id={s.change} label={`${pl?.name ?? s.plugin}: ${decl?.label ?? s.key}`} from={s.from} to={s.to} labels={decl?.labels} />
            })}
            {plan.hotkeys.map((h) => <Setting key={h.key} pick={pick} id={h.change} label={`Hotkey: ${h.key}`} from={h.from} to={h.to} />)}
            {plan.skipped.length > 0 && <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground" data-bundle-skipped>Kept as they are: {plan.skipped.map((x) =>
              `${pluginById(x.plugin)?.name ?? x.plugin}: ${pluginById(x.plugin)?.settingsDecls?.[x.key]?.label ?? x.key} (${x.why})`).join("; ")}</p>}
          </Panel>
        )}
        {files.length > 0 && (
          <Panel title="Adds" icon={FilePlus}>
            {files.map((f) => {
              const own = has(`file:${f}`) ? `file:${f}` : undefined
              return f === b.guide ? (
                <ChangeLine key={f} pick={pick} id={own} className="min-h-8 text-[14px]" data-bundle-guide>
                  <BookOpen className="size-4 shrink-0" strokeWidth={2} style={{ color: tintOfBundle(b) }} />
                  <span className="min-w-0 flex-1 truncate font-medium">{stem(f)}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground max-sm:hidden">its guide, opened after applying</span>
                </ChangeLine>
              ) : <ChangeLine key={f} pick={pick} id={own} rides={own ? undefined : `pin:${f}`} className="min-h-8 text-[14px]"><span className="min-w-0 truncate">{f}</span></ChangeLine>
            })}
            {plan.files.kept.length > 0 && <p className="mt-1 text-[13px] text-muted-foreground">Already here, kept as they are: {plan.files.kept.map(stem).join(", ")}</p>}
          </Panel>
        )}
      </div>
    </>
  )
}

function Setting({ pick, id, label, from, to, labels }: { pick?: Picks; id: string; label: string; from: unknown; to: unknown; labels?: Record<string, string> }) {
  const name = (v: unknown) => (labels && v !== null && v !== undefined && labels[String(v)]) || showValue(v)
  return (
    <ChangeLine pick={pick} id={id} className="min-h-8 text-[14px]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* (a value as long as a list is cut off, its tip whole) */}
      <span className="ml-1 max-w-[40%] shrink-0 truncate text-muted-foreground line-through decoration-foreground/25" data-tip={name(from).length > 24 ? name(from) : undefined}>{name(from)}</span>
      <ArrowRight className="size-3.5 shrink-0 text-tertiary" strokeWidth={2.25} />
      <span className="max-w-[40%] shrink-0 truncate font-medium" data-tip={name(to).length > 24 ? name(to) : undefined}>{name(to)}</span>
    </ChangeLine>
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
          <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
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
      <SheetHead icon={Import} tint="var(--primary)" kicker="Bundles" title="Import a bundle" sub="A layout or pack someone shared. Its preview says what it would change, then you apply it or keep it." />
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
