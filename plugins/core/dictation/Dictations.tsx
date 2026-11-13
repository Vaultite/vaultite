import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AppWindow, ClipboardCopy, Copy, FileText, Mic, MoreHorizontal, RotateCcw, Settings, SquareTerminal, TextCursorInput, Trash2, TriangleAlert, type LucideIcon } from "lucide-react"
import {
  Button, cn, confirmDialog, copyText, dateText, FilterField, fmtDay, fmtLongDay, isDesktop, iso, LoadingSidebarRows, menuBelow, menuFor, notify, notifyError, onDictation, op, openFile,
  openPluginSettings, pluginSettings, removals, Segmented, SidebarHeading, stem, useKeptCount, type MenuItem,
} from "@vaultite"
import { insertAgain } from "./place"

type Landing = "in" | "front" | "origin" | "clipboard" | "cancelled" | "lost" | "live"
export type Item = { id: string; t: number; text: string; kind: "dictation" | "companion"
  where: { kind: "note" | "terminal" | "field" | "app" | "companion"; path?: string; name?: string }
  landing?: Landing; inbox?: boolean; why?: string; said?: string; who?: string }
type History = { here: boolean; keep: boolean; items: Item[]; total: number }
type Show = "all" | "lost" | "companion"

const TIME = { hour: "numeric", minute: "2-digit" } as const
const LIMIT = 500
const missed = (x: Item) => x.landing === "lost" || x.landing === "cancelled" || x.landing === "clipboard"

function useHistory(q: string) {
  const [data, setData] = useState<History | null>(null), [error, setError] = useState<unknown>(null), [n, setN] = useState(0)
  useEffect(() => {
    let on = true
    const ask = () => { if (document.visibilityState === "visible") op<History>("dictation.history", { q, limit: LIMIT }).then((d) => { if (on) { setData(d); setError(null) } }, (e) => on && setError(e)) }
    ask()
    const t = setInterval(ask, 15_000)
    const off = onDictation((e) => { if (e.type === "end") setTimeout(ask, 1200) })
    addEventListener("focus", ask)
    return () => { on = false; clearInterval(t); off(); removeEventListener("focus", ask) }
  }, [q, n])
  return { data, error, again: () => setN((x) => x + 1) }
}

const removing = removals()

function forget(x: Item, again: () => void) {
  let undone = false
  void removing.remove(x.id, async () => {
    notify("Removed from Dictations", { action: { label: "Undo", run: () => { undone = true; removing.back([x.id]) } } })
    await new Promise((r) => setTimeout(r, 8000))
    if (!undone) { await op("dictation.forget", { id: x.id }); again() }
  }, "Couldn't remove it")
}

export async function askClear(after?: () => void) {
  const ok = await confirmDialog({
    title: "Clear your dictations?",
    body: "Every dictation's words kept on this Mac go. What you dictated stays where it landed, and your asks to the companion stay on its page.",
    confirm: "Clear", danger: true,
  })
  if (!ok) return
  try { await op("dictation.clear"); notify("Cleared your dictations"); after?.() } catch (e) { notifyError(e, "Couldn't clear your dictations") }
}

const settings = pluginSettings<{ history?: unknown }>("dictation")

export function DictationsView() {
  const [q, setQ] = useState(""), [text, setText] = useState(""), [show, setShow] = useState<Show>("all")
  useEffect(() => { const t = setTimeout(() => setText(q.trim()), 150); return () => clearTimeout(t) }, [q])
  const { data, error, again } = useHistory(text)
  const { list: items, leaving } = removing.use(data?.items, (x) => x.id)
  const counts = useMemo(() => ({ lost: (items ?? []).filter((x) => x.kind === "dictation" && missed(x)).length, companion: (items ?? []).filter((x) => x.kind === "companion").length }), [items])
  const shown = useMemo(() => (items ?? []).filter((x) => show === "all" || (show === "companion" ? x.kind === "companion" : x.kind === "dictation" && missed(x))), [items, show])
  const days = useMemo(() => {
    const out: { day: string; items: Item[] }[] = []
    for (const x of shown) { const day = iso(new Date(x.t)); if (out.at(-1)?.day !== day) out.push({ day, items: [] }); out.at(-1)!.items.push(x) }
    return out
  }, [shown])
  const rows = useKeptCount(text ? null : "dictation:history", data ? Math.min(12, shown.length) : undefined, 6)
  const keep = settings.use().history !== false
  const more = (e: React.MouseEvent) => menuBelow(e, [
    ...(data?.here ? [{ label: "Keep dictations", checked: keep, run: () => void settings.set({ history: !keep }) }] : []),
    { label: "Dictation settings", icon: Settings, run: () => openPluginSettings("dictation", "history") },
    ...(data?.here ? [{ label: "Clear dictations…", icon: Trash2, danger: true, sep: true, run: () => void askClear(again) }] : []),
  ])
  return (
    <div className="mx-auto max-w-[760px] pb-16" data-dictations>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mb-1 text-[22px] leading-[28px] font-bold max-md:hidden">Dictations</h1>
          <p className="text-[13px] leading-[18px] text-muted-foreground max-md:text-[15px] max-md:leading-[20px]">
            {data && !data.here ? "Your asks to the companion. Dictations are kept on each Mac, by its Vaultite app: open this there to see them." : "What you said, newest first, kept on this Mac for 30 days: landed or not."}
          </p>
        </div>
        <Button look="quiet" size="small" className="px-1.5 md:mt-0.5 max-md:size-11" onClick={more} aria-label="More" data-tip="More" data-dictations-more><MoreHorizontal className="size-4" /></Button>
      </header>
      {data && !keep && data.here && (
        <Note icon={Mic}>Keep dictations is off: new dictations aren't kept. <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => void settings.set({ history: true })}>Turn it on</button></Note>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterField value={q} onChange={setQ} placeholder="Search what you said" />
        {(counts.lost > 0 || counts.companion > 0) && (
          <Segmented label="Show" value={show} onChange={setShow} className="max-md:w-full"
            options={[{ value: "all", label: "All" }, ...(counts.lost ? [{ value: "lost" as const, label: `Didn't land ${counts.lost}` }] : []), ...(counts.companion ? [{ value: "companion" as const, label: "Companion" }] : [])]} />
        )}
      </div>
      {!data ? (error ? <p className="px-1.5 text-[15px] text-muted-foreground">Couldn't read your dictations.</p> : <section data-size-up><LoadingSidebarRows count={rows} /></section>)
        : !days.length ? <EmptyList text={text} here={data.here} keep={keep} filtered={show !== "all"} />
        : (
          <div className="flex flex-col gap-5" data-dictations-list>
            {days.map((d) => (
              <section key={d.day} data-dictations-day={d.day}>
                <SidebarHeading title={dayTitle(d.day)} open />
                <div className="flex flex-col">{d.items.map((x) => <Row key={x.id} x={x} q={text} leaving={leaving(x.id)} forget={() => forget(x, again)} />)}</div>
              </section>
            ))}
            {data.total > data.items.length && <p className="px-1.5 text-[13px] text-tertiary">The newest {data.items.length} of {data.total}: search to find older ones.</p>}
          </div>
        )}
    </div>
  )
}

function Note({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-card bg-foreground/[0.04] px-3 py-2.5 text-[13px] leading-[18px] text-muted-foreground max-md:text-[15px] max-md:leading-[20px]" data-dictations-note>
      <Icon className="mt-[2px] size-3.5 shrink-0" strokeWidth={2} /><div>{children}</div>
    </div>
  )
}

function EmptyList({ text, here, keep, filtered }: { text: string; here: boolean; keep: boolean; filtered: boolean }) {
  const say = text ? `Nothing you said matches "${text}".` : filtered ? "Nothing here: everything you said landed where it was going."
    : !here ? "Nothing said to the companion lately. To see your dictations, open Dictations in Vaultite on the Mac you dictated on."
    : keep ? `Nothing dictated yet. Press ${isDesktop() ? "⌘J or the dictation keys" : "the dictation keys"} and speak: what you say is kept here, in case it doesn't land.` : "Nothing kept."
  return <p className="px-1.5 pt-2 text-[15px] leading-[20px] text-muted-foreground" data-dictations-empty>{say}</p>
}

function dayTitle(day: string) {
  const name = fmtDay(day)
  return name === "Today" || name === "Yesterday" ? `${name} · ${fmtLongDay(day)}` : fmtLongDay(day)
}

function placeOf(x: Item): { icon: LucideIcon; label: string; open?: () => void } {
  const w = x.where
  if (x.kind === "companion") return { icon: Mic, label: `Asked ${x.who || "the companion"}${w.name ? ` · ${w.name}` : ""}` }
  if (w.kind === "note") return { icon: FileText, label: w.path ? stem(w.path) : "A note", ...(w.path ? { open: () => openFile(w.path!) } : {}) }
  if (w.kind === "terminal") return { icon: SquareTerminal, label: w.name || "Terminal" }
  if (w.kind === "field") return { icon: TextCursorInput, label: w.name || "A field" }
  return { icon: AppWindow, label: w.name || "Another app" }
}

function statusOf(x: Item): { label: string; warn?: boolean; live?: boolean } | null {
  if (x.kind === "companion") return null
  if (x.landing === "lost") return { label: x.why === "closed" ? "Didn't land: the app closed" : x.why === "failed" ? "Didn't land: dictation stopped" : x.why === "elsewhere" ? "Didn't land: another dictation began" : "Didn't land", warn: true }
  if (x.landing === "cancelled") return { label: "Cancelled, not typed in" }
  if (x.landing === "clipboard") return { label: x.inbox ? "Copied, and in your inbox" : "Copied, not typed in" }
  if (x.landing === "live") return { label: "Listening", live: true }
  if (x.landing === "origin") return { label: "Back where you began" }
  return null
}

function Lit({ text, q }: { text: string; q: string }) {
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!words.length) return <>{text}</>
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-[2px] bg-[var(--yellow)]/30 text-inherit">{p}</mark> : p))}</>
}

const LONG = 320

function Row({ x, q, leaving, forget }: { x: Item; q: string; leaving?: ""; forget: () => void }) {
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false)
  const place = placeOf(x), status = statusOf(x), long = x.text.length > LONG
  const copy = () => void copyText(x.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, (e) => notifyError(e, "Couldn't copy it"))
  const insert = () => void insertAgain(x.text)
  const menu = (): MenuItem[] => [
    { label: "Copy", icon: Copy, run: copy },
    { label: "Insert again", icon: RotateCcw, run: insert },
    ...(place.open ? [{ label: `Open ${place.label}`, icon: FileText, run: place.open }] : []),
    ...(x.kind === "dictation" ? [{ label: "Remove from Dictations", icon: Trash2, danger: true, sep: true, run: forget }] : []),
  ]
  const row = useRef<HTMLDivElement>(null)
  return (
    <div ref={row} onContextMenu={menuFor(menu)} data-dictation={x.id} data-dictation-kind={x.kind} data-dictation-landing={x.landing} data-leaving={leaving}
      className="group relative grid grid-cols-[68px_1fr] gap-x-3 border-b border-border/60 py-3 last:border-b-0 max-md:grid-cols-1 max-md:gap-y-1">
      <time className="pt-[2px] pl-1.5 text-[12px] whitespace-nowrap leading-[18px] text-tertiary tabular-nums max-md:order-2 max-md:hidden" dateTime={new Date(x.t).toISOString()}>{dateText(x.t, TIME)}</time>
      <div className="min-w-0 pr-[76px] max-md:pr-0">
        <p className={cn("text-[15px] leading-[22px] break-words whitespace-pre-wrap select-text", !open && long && "line-clamp-4", x.kind === "companion" && "text-foreground/90")} data-dictation-text>
          <Lit text={x.text} q={q} />
        </p>
        {long && <button type="button" className="mt-0.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : "Show all"}</button>}
        {x.said && <p className="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-[13px] leading-[18px] text-muted-foreground select-text" data-dictation-said>{x.said}</p>}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[16px] text-muted-foreground max-md:text-[13px]">
          <span className="md:hidden text-tertiary tabular-nums">{dateText(x.t, TIME)}</span>
          {place.open
            ? <button type="button" onClick={place.open} className="flex min-w-0 items-center gap-1 rounded-[4px] hover:text-foreground" data-dictation-where><place.icon className="size-3 shrink-0" strokeWidth={2} /><span className="truncate">{place.label}</span></button>
            : <span className="flex min-w-0 items-center gap-1" data-dictation-where><place.icon className="size-3 shrink-0" strokeWidth={2} /><span className="truncate">{place.label}</span></span>}
          {status && (
            <span data-dictation-status className={cn("flex items-center gap-1 rounded-chip px-1.5 py-[1px]", status.warn ? "bg-[var(--orange)]/12 text-[var(--orange)]" : status.live ? "bg-[var(--blue)]/12 text-[var(--blue)]" : "bg-foreground/[0.05]")}>
              {status.warn ? <TriangleAlert className="size-3" strokeWidth={2.25} /> : x.landing === "clipboard" ? <ClipboardCopy className="size-3" strokeWidth={2.25} /> : null}
              {status.live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}{status.label}
            </span>
          )}
        </div>
      </div>
      <div className="absolute top-2.5 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:static max-md:-mb-2 max-md:-ml-2.5 max-md:opacity-100 [@media(hover:none)]:opacity-100">
        <Action icon={copied ? ClipboardCopy : Copy} label={copied ? "Copied" : "Copy"} onClick={copy} data-dictation-copy />
        <Action icon={RotateCcw} label="Insert again" onClick={insert} data-dictation-insert />
        <Action icon={MoreHorizontal} label="More" onClick={(e) => menuBelow(e, menu())} />
      </div>
    </div>
  )
}

function Action({ icon: Icon, label, onClick, ...rest }: { icon: LucideIcon; label: string; onClick: (e: React.MouseEvent) => void } & Record<`data-${string}`, unknown>) {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={onClick} {...rest}
      className="grid size-7 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground max-md:size-11">
      <Icon className="size-[15px] max-md:size-[18px]" strokeWidth={2} />
    </button>
  )
}
