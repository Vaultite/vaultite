import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, Globe, Pause, Play } from "lucide-react"
import { Bar, Button, cn, dateText, ink, notifyError, openWebLink, usePaneTopBar, webPages } from "@vaultite"
import { hostOf } from "./address"
import { SiteIcon } from "./icons"
import { replays, type ReplayKeys } from "./replaykeys"
import { useShot, wantShots } from "./runshots"
import { axisOf, count, itemsOf, kindOf, nearest, pageOf, PAUSE_MS, repeatsOf, said, short, SLOW_MS, span, verbOf, type Item, type Run, type Step } from "./steps"

const TIME = { hour: "numeric", minute: "2-digit", second: "2-digit" } as const
const DAY = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const
const time = (t: number) => dateText(t, TIME)
const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))
const GUT = 30, CARD = 128, SLOT = GUT + CARD
const SPEEDS = [1, 2, 4]
const RANK = ["failed", "user", "go", "input", "look", "script"]
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

function itemAt(items: Item[], i: number) {
  let lo = 0, hi = items.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (items[mid].first <= i) lo = mid; else hi = mid - 1 }
  return lo
}

export function Replay({ run, info, live, back }: { run: string; info?: Run; live: boolean; back: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [at, setAt] = useState(0)
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set())
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  usePaneTopBar(bar)

  const had = useRef<{ run: string; steps: Step[] }>({ run, steps: [] })
  useEffect(() => {
    let stop = false
    if (had.current.run !== run) had.current = { run, steps: [] }
    const read = () => void engine("agents:run", run, had.current.steps.length).then((r) => {
      if (stop) return
      const more = Array.isArray(r) ? (r as Step[]) : []
      let have = had.current.steps
      if (have.length && !more.length) return
      const first = !have.length
      const was = have.length - 1
      have = had.current.steps = have.concat(more)
      setSteps(have)
      setAt((a) => (first ? (live ? have.length - 1 : 0) : a === was ? have.length - 1 : a))
    }, (e) => { if (!stop) { notifyError(e, "Couldn't read the run"); back() } })
    read()
    const timer = live ? setInterval(() => { if (document.visibilityState === "visible") read() }, 2000) : 0
    return () => { stop = true; clearInterval(timer) }
  }, [run, live, back])
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])

  const n = steps?.length ?? 0
  const items = useMemo(() => itemsOf(steps ?? [], unfolded), [steps, unfolded])
  const axis = useMemo(() => axisOf(steps ?? []), [steps])
  const go = useCallback((i: number) => setAt(Math.max(0, Math.min(n - 1, i))), [n])
  const fold = useCallback((first: number) => setUnfolded((o) => { const x = new Set(o); if (x.has(first)) x.delete(first); else x.add(first); return x }), [])
  const play = useCallback(() => {
    if (!playing && at >= n - 1 && !live) setAt(0)
    setPlaying(!playing)
  }, [playing, at, n, live])
  useEffect(() => {
    if (!playing || !steps) return
    const k = itemAt(items, at), next = items[k + 1]
    if (!next) {
      if (live) return
      const t = setTimeout(() => setPlaying(false), 0)
      return () => clearTimeout(t)
    }
    wantShots(run, [steps[next.last].shot, steps[items[k + 2]?.last ?? next.last].shot], false)
    const t = setTimeout(() => setAt(next.last), 1000 / speed)
    return () => clearTimeout(t)
  }, [playing, at, items, steps, speed, live, run])
  useEffect(() => { if (steps) wantShots(run, [steps[at + 1]?.shot, steps[at - 1]?.shot], false) }, [steps, at, run])

  const keys = useRef<ReplayKeys>(null!)
  useLayoutEffect(() => { keys.current = { step: (by) => go(at + by), edge: (last) => go(last ? n - 1 : 0), play, playing: () => playing } })
  useLayoutEffect(() => {
    const el = root.current
    if (el) replays.set(el, () => keys.current)
  }, [])

  const s = steps?.[at]
  const title = info?.task || steps?.[0]?.task || info?.title || hostOf(steps?.[0]?.url ?? "") || "A run"
  const by = info?.by || steps?.[0]?.by || "An agent"
  const summary = info?.summary || steps?.findLast((x) => x.summary)?.summary
  const iconBtn = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <div ref={root} tabIndex={-1} className="@container flex h-full min-h-0 flex-col outline-none" data-web-replay-steps={n} data-web-replay-run={run}>
      <div ref={bar} className="flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-2">
        <button type="button" onClick={back} data-web-replay-back
          className="flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] pr-2 pl-1 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <ChevronLeft className="size-4" strokeWidth={2} />Runs
        </button>
        <span className="h-5 w-px shrink-0 bg-border" />
        <div className="flex min-w-0 flex-1 flex-col pl-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-[3em] truncate text-[14px] font-semibold">{title}</span>
            <span className="min-w-0 shrink-[4] truncate text-[12px] text-muted-foreground">{by}{steps?.[0] ? ` · ${dateText(steps[0].t, DAY)}` : ""}</span>
            {live && <span className="flex shrink-0 items-center gap-1 self-center rounded-full px-1.5 text-[11px] font-medium text-ink-(--green)" style={{ background: tint("var(--green)", 14) }}>
              <span className="size-1.5 rounded-full bg-(--green) motion-safe:animate-pulse" />Live</span>}
          </span>
          {summary && <span className="truncate text-[12px] text-muted-foreground">{summary}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="First step" data-tip="First step" disabled={!n || at === 0} onClick={() => go(0)} className={cn(iconBtn, "@max-2xl:hidden")}><ChevronFirst className="size-4" /></button>
          <button type="button" aria-label="Previous step" data-tip="Previous step" disabled={!n || at === 0} onClick={() => go(at - 1)} className={iconBtn}><ChevronLeft className="size-4" /></button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} data-tip={playing ? "Pause" : "Play"} disabled={n < 2} onClick={play} data-web-replay-play={playing ? "playing" : "paused"}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85 disabled:opacity-40">
            {playing ? <Pause className="size-3.5" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={0} />}
          </button>
          <button type="button" aria-label="Next step" data-tip="Next step" disabled={!n || at >= n - 1} onClick={() => go(at + 1)} className={iconBtn}><ChevronRight className="size-4" /></button>
          <button type="button" aria-label="Last step" data-tip="Last step" disabled={!n || at >= n - 1} onClick={() => go(n - 1)} className={cn(iconBtn, "@max-2xl:hidden")}><ChevronLast className="size-4" /></button>
          <button type="button" aria-label="Speed" data-tip="Speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            className="h-7 min-w-8 shrink-0 cursor-pointer rounded-[6px] px-1.5 text-[12px] font-medium text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground">{speed}×</button>
          <span className="ml-1 min-w-[72px] text-right text-[12px] text-tertiary tabular-nums @max-2xl:hidden" data-web-replay-at>{n ? `${count(at + 1)} of ${count(n)}` : ""}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <Stage run={run} steps={steps} at={at} />
        <div className="max-h-[42%] shrink-0 overflow-y-auto border-t-[0.5px] border-border @3xl:max-h-none @3xl:w-[320px] @3xl:border-t-0 @3xl:border-l-[0.5px]">
          {s && steps ? <Details steps={steps} at={at} unfolded={unfolded} fold={fold} /> : <DetailsLoading />}
        </div>
      </div>
      <div className="shrink-0 border-t-[0.5px] border-border">
        {steps && n > 1 && <Track run={run} steps={steps} axis={axis} at={at} go={go} />}
        <Filmstrip run={run} steps={steps} items={items} at={at} go={go} fold={fold} count={info?.steps} />
      </div>
    </div>
  )
}

function Stage({ run, steps, at }: { run: string; steps: Step[] | null; at: number }) {
  const s = steps?.[at]
  let from = at
  if (steps && s && !s.shot) { from = -1; for (let i = at - 1; i >= 0; i--) if (steps[i].shot) { from = i; break } }
  const shot = from >= 0 ? steps?.[from]?.shot : null
  const big = useShot(run, shot, false), small = useShot(run, shot, true)
  const [last, setLast] = useState<string | null>(null)
  const now = big ?? small ?? null
  if (now && now !== last) setLast(now)
  const src = now ?? (shot ? last : null)
  const own = !!s?.shot
  return (
    <div className="relative min-h-[160px] min-w-0 flex-1 bg-foreground/[0.025]" data-web-replay-stage>
      {src && (
        <div className="absolute inset-3 flex items-center justify-center @3xl:inset-5">
          <img src={src} alt={s ? said(s) : ""} draggable={false}
            className={cn("max-h-full max-w-full rounded-[8px] object-contain shadow-[0_4px_24px_rgb(0_0_0/0.10)] ring-[0.5px] ring-border transition-opacity duration-150",
              !own && "opacity-45 grayscale", !big && "blur-[0.5px]")} />
        </div>
      )}
      {s && !own && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <span className="flex max-w-[420px] items-center gap-2 rounded-[10px] bg-background/92 px-3 py-2 text-[13px] leading-[18px] shadow-lg ring-[0.5px] ring-border">
            <Globe className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
            {src ? (s.failed ? "No picture of a call that failed: the page as it was the step before" : "No picture of this step: the page as it was the step before")
              : "No picture of this step (none is kept while a page shows a password)"}
          </span>
        </div>
      )}
      {!steps && <div className="absolute inset-5 animate-pulse rounded-[8px] bg-foreground/[0.04]" />}
    </div>
  )
}

function DetailsLoading() {
  return (
    <div className="loading-in flex flex-col gap-2 p-4 text-[14px]" aria-busy data-web-replay-loading="">
      <Bar w="70%" /><Bar w="40%" /><Bar w="85%" /><Bar w="55%" />
    </div>
  )
}

const KNOWN = new Set(["t", "tab", "by", "task", "summary", "url", "title", "action", "ref", "name", "value", "fields", "shot", "failed", "ms"])
const LABELS: Record<string, string> = { site: "Site", result: "Result", approved: "Approved", entry: "Entry" }
const label = "mb-1 text-[11px] font-medium text-tertiary"

function Details({ steps, at, unfolded, fold }: { steps: Step[]; at: number; unfolded: ReadonlySet<number>; fold: (first: number) => void }) {
  const s = steps[at], before = steps[at - 1]
  const k = kindOf(s)
  const gap = before ? s.t - before.t : null
  const repeats = repeatsOf(steps, at)
  const code = (s.action === "run" || s.action === "evaluate") && s.value
  const plain = !code && s.value ? s.value : ""
  const extra = Object.entries(s).filter(([key, v]) => !KNOWN.has(key) && (typeof v === "string" || typeof v === "number") && v !== "")
  return (
    <div className="flex flex-col gap-4 p-4" data-web-replay-details>
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px]" style={{ background: tint(k.color, 15), color: ink(k.color) }}>
          <k.icon className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[15px] leading-[20px] font-medium break-words select-text", s.failed && "text-ink-(--red)")}>{said(s)}</p>
          <p className="mt-0.5 text-[12px] text-tertiary tabular-nums">{time(s.t)} · step {count(at + 1)} of {count(steps.length)}</p>
        </div>
      </div>
      {s.failed && (
        <div className="rounded-[8px] px-3 py-2 text-[13px] leading-[18px] select-text" style={{ background: tint("var(--red)", 10) }} data-web-replay-failed>
          <span className="font-medium text-ink-(--red)">Failed: </span>{s.failed}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Fact name="Since the step before" value={gap === null ? "First step" : span(gap)} warn={gap !== null && gap >= SLOW_MS} />
        <Fact name="The call took" value={typeof s.ms === "number" ? span(s.ms) : "Not kept"} dim={typeof s.ms !== "number"} warn={typeof s.ms === "number" && s.ms >= 10_000} />
      </div>
      {repeats && (
        <div className="flex items-center gap-2 rounded-[8px] bg-foreground/[0.04] py-1.5 pr-1.5 pl-3 text-[13px] leading-[18px]">
          <span className="min-w-0 flex-1 text-muted-foreground">
            {count(at - repeats[0] + 1)} of {count(repeats[1] - repeats[0] + 1)} like it in a row, over {span(steps[repeats[1]].t - steps[repeats[0]].t)}
          </span>
          <Button look="quiet" size="small" onClick={() => fold(repeats[0])} data-web-replay-fold>{unfolded.has(repeats[0]) ? "Fold them" : "Show each"}</Button>
        </div>
      )}
      {code && (
        <div>
          <p className={label}>{s.action === "run" ? "Script" : "Expression"}</p>
          <pre className="max-h-72 overflow-auto rounded-[8px] bg-muted p-2.5 font-mono text-[12px] leading-[17px] break-all whitespace-pre-wrap select-text">{s.value}</pre>
        </div>
      )}
      {plain && (
        <div>
          <p className={label}>{s.action === "help" ? "Asked" : s.action === "login" ? "Entry" : s.action === "press" ? "Keys" : s.action === "open" || s.action === "navigate" ? "Address" : "Value"}</p>
          <p className="text-[13px] leading-[18px] [overflow-wrap:anywhere] select-text">{plain}</p>
        </div>
      )}
      {s.fields?.length ? (
        <div>
          <p className={label}>Fields</p>
          <div className="flex flex-col gap-1">
            {s.fields.map((f, i) => (
              <div key={i} className="flex min-w-0 gap-2 text-[13px] leading-[18px]">
                <span className="w-[42%] shrink-0 truncate text-muted-foreground">{f.name || f.ref}</span>
                <span className="min-w-0 break-words select-text">{f.value ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {extra.length > 0 && (
        <div className="flex flex-col gap-1">
          {extra.map(([key, v]) => (
            <div key={key} className="flex min-w-0 gap-2 text-[13px] leading-[18px]">
              <span className="w-[42%] shrink-0 truncate text-muted-foreground">{LABELS[key] ?? key}</span>
              <span className="min-w-0 break-words select-text">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      {s.url && (
        <div>
          <p className={label}>Page</p>
          <div className="flex min-w-0 items-start gap-2">
            <SiteIcon url={s.url} className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[18px] font-medium break-words">{s.title || hostOf(s.url)}</p>
              <p className="text-[12px] leading-[16px] [overflow-wrap:anywhere] text-tertiary select-text">{s.url}</p>
            </div>
          </div>
          {/^https?:/i.test(s.url) && <Button look="secondary" size="small" className="mt-2" onClick={() => openWebLink(s.url, { newTab: true, front: true })}>
            <ExternalLink className="size-3.5" strokeWidth={2} />Open page</Button>}
        </div>
      )}
    </div>
  )
}

function Fact({ name, value, warn, dim }: { name: string; value: string; warn?: boolean; dim?: boolean }) {
  return (
    <div className="rounded-[8px] bg-foreground/[0.04] px-2.5 py-1.5">
      <p className="truncate text-[11px] text-tertiary">{name}</p>
      <p className={cn("text-[14px] font-medium tabular-nums", warn && "text-ink-(--orange)", dim && "font-normal text-tertiary")}>{value}</p>
    </div>
  )
}

function Track({ run, steps, axis, at, go }: { run: string; steps: Step[]; axis: ReturnType<typeof axisOf>; at: number; go: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const H = 30
  const bars = useMemo(() => {
    if (!w) return []
    const n = Math.max(1, Math.floor(w / 3))
    const tally = Array.from({ length: n }, () => ({ steps: 0, failed: false, rank: 99, color: "" }))
    steps.forEach((s, i) => {
      const b = tally[Math.min(n - 1, Math.floor(axis.x[i] * n))]
      b.steps++
      if (s.failed) b.failed = true
      const k = kindOf(s), r = RANK.indexOf(k.kind)
      if (r < b.rank) { b.rank = r; b.color = k.color }
    })
    const most = Math.max(1, ...tally.map((b) => b.steps))
    return tally.flatMap((b, i) => b.steps ? [{
      x: (i / n) * w, h: b.failed ? H : 8 + (H - 8) * Math.sqrt(b.steps / most),
      color: b.failed ? "var(--red)" : b.color,
    }] : [])
  }, [steps, axis, w])
  const breaks = useMemo(() => {
    const named: number[] = []
    const out = axis.breaks.map((b) => ({ ...b, named: false }))
    for (const b of [...out].sort((p, q) => q.ms - p.ms)) if (named.every((x) => Math.abs(x - b.at * w) > 40)) { b.named = true; named.push(b.at * w) }
    return out
  }, [axis, w])
  const stepAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    return nearest(axis.x, Math.max(0, Math.min(1, (clientX - r.left) / r.width)))
  }
  const dragging = useRef(false)
  const h = hover !== null ? steps[hover] : null
  return (
    <div className="px-4 pt-4 pb-1">
      <div ref={box} className="relative h-[30px] cursor-pointer touch-none" data-web-replay-track
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(stepAt(e.clientX)) }}
        onPointerMove={(e) => { const i = stepAt(e.clientX); setHover(i); if (dragging.current) go(i) }}
        onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }}
        onPointerLeave={() => { if (!dragging.current) setHover(null) }}>
        <span className="absolute inset-x-0 bottom-0 h-px bg-border" />
        <svg width={w} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
          {bars.map((b, i) => <rect key={i} x={b.x} y={H - b.h} width={2} height={b.h} rx={1} style={{ fill: b.color, opacity: 0.9 }} />)}
        </svg>
        {breaks.map((b, i) => (
          <span key={i} className="pointer-events-none absolute top-0 bottom-0 flex -translate-x-1/2 flex-col items-center" style={{ left: b.at * w }}>
            <span className={cn("h-full border-l border-dashed", b.named ? "border-foreground/30" : "border-foreground/12")} />
            {b.named && <span className="absolute -top-[13px] rounded-[3px] bg-background px-0.5 text-[10px] leading-[12px] whitespace-nowrap text-tertiary tabular-nums">{short(b.ms)}</span>}
          </span>
        ))}
        <span className="pointer-events-none absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2 rounded-full bg-primary" style={{ left: axis.x[at] * w }}>
          <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary" />
        </span>
        {h && hover !== null && <Preview run={run} s={h} i={hover} n={steps.length} left={Math.max(0, Math.min(w - 200, axis.x[hover] * w - 100))} />}
      </div>
      <div className="mt-1 flex justify-between text-[10px] leading-[12px] text-tertiary tabular-nums">
        <span>{time(steps[0].t)}</span><span>{span(steps[steps.length - 1].t - steps[0].t)} in all</span><span>{time(steps[steps.length - 1].t)}</span>
      </div>
    </div>
  )
}

function Preview({ run, s, i, n, left }: { run: string; s: Step; i: number; n: number; left: number }) {
  const src = useShot(run, s.shot, true)
  const k = kindOf(s)
  return (
    <div className="pointer-events-none absolute bottom-[calc(100%+10px)] z-10 w-[200px] overflow-hidden rounded-[10px] bg-popover shadow-xl ring-[0.5px] ring-border" style={{ left }} data-web-replay-preview>
      <div className="aspect-[16/10] w-full bg-muted">{src && <img src={src} alt="" className="size-full object-cover object-top" />}</div>
      <div className="px-2 py-1.5">
        <p className="flex min-w-0 items-center gap-1 text-[12px] font-medium"><k.icon className="size-3 shrink-0" style={{ color: k.color }} strokeWidth={2.25} /><span className="truncate">{said(s)}</span></p>
        <p className="text-[11px] text-tertiary tabular-nums">{time(s.t)} · {count(i + 1)} of {count(n)}</p>
      </div>
    </div>
  )
}

function Filmstrip({ run, steps, items, at, go, fold, count: expected }: {
  run: string; steps: Step[] | null; items: Item[]; at: number; go: (i: number) => void; fold: (first: number) => void; count?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 1200 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const look = () => setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }))
    const ro = new ResizeObserver(look)
    ro.observe(el)
    el.addEventListener("scroll", look, { passive: true })
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { e.preventDefault(); el.scrollLeft += e.deltaY } }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener("scroll", look); el.removeEventListener("wheel", wheel) }
  }, [])
  const cur = items.length ? itemAt(items, at) : 0
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !items.length) return
    const x = cur * SLOT + GUT
    if (x >= el.scrollLeft + 8 && x + CARD <= el.scrollLeft + el.clientWidth - 8) return
    const to = Math.max(0, x - (el.clientWidth - CARD) / 2)
    el.scrollTo({ left: to, behavior: Math.abs(to - el.scrollLeft) < el.clientWidth * 2 ? "smooth" : "auto" })
  }, [cur, items.length])
  const pageEnds = useMemo(() => {
    const ends = new Int32Array(items.length)
    let end = items.length
    for (let k = items.length - 1; k >= 0; k--) { ends[k] = end; if (items[k].startsPage) end = k }
    return ends
  }, [items])
  const from = Math.max(0, Math.floor((view.left - 800) / SLOT)), to = Math.min(items.length, Math.ceil((view.left + view.width + 800) / SLOT))
  let lead = -1
  if (steps) for (let k = Math.min(Math.floor(view.left / SLOT), items.length - 1); k >= 0; k--) if (items[k].startsPage) { lead = k; break }
  return (
    <div ref={box} className="relative isolate h-[164px] overflow-x-auto overflow-y-hidden" data-web-replay-film>
      {!steps ? (
        <div className="loading-in flex gap-[30px] pt-[34px] pl-[30px]" aria-busy>
          {Array.from({ length: Math.min(expected ?? 8, 12) }, (_, i) => <span key={i} className="h-[80px] w-[128px] shrink-0 rounded-[6px] bg-foreground/[0.05]" />)}
        </div>
      ) : (
        <div className="relative h-full" style={{ width: items.length * SLOT + GUT }}>
          {lead >= 0 && <PageName s={steps[items[lead].first]} left={Math.max(lead * SLOT, view.left) + GUT} right={pageEnds[lead] * SLOT} />}
          {items.slice(from, to).map((it, j) => {
            const k = from + j
            return <Card key={`${it.first}-${it.last}`} run={run} steps={steps} it={it} k={k} at={at} go={go} fold={fold}
              page={it.startsPage ? { left: k * SLOT + GUT, right: pageEnds[k] * SLOT, named: k !== lead } : null} />
          })}
        </div>
      )}
    </div>
  )
}

function PageName({ s, left, right }: { s: Step; left: number; right: number }) {
  return (
    <span className="pointer-events-none absolute top-2.5 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden pr-2 text-[12px] whitespace-nowrap text-muted-foreground"
      style={{ left, width: Math.max(0, right - left - 4) }} data-web-replay-page={pageOf(s.url)}>
      <SiteIcon url={s.url} className="size-3.5 shrink-0" />
      <span className="truncate"><span className="font-medium text-foreground">{hostOf(s.url)}</span>{s.title ? ` · ${s.title}` : ""}</span>
    </span>
  )
}

function Card({ run, steps, it, k, at, go, fold, page }: {
  run: string; steps: Step[]; it: Item; k: number; at: number; go: (i: number) => void; fold: (first: number) => void; page: { left: number; right: number; named: boolean } | null
}) {
  const inside = at >= it.first && at <= it.last
  const s = steps[inside ? at : it.last], first = steps[it.first]
  const before = steps[it.first - 1]
  const gap = before ? first.t - before.t : 0
  const src = useShot(run, s.shot, true)
  const k0 = kindOf(first)
  const n = it.last - it.first + 1
  const failed = !!s.failed
  return (
    <>
      {page?.named && <PageName s={first} left={page.left} right={page.right} />}
      {page && k > 0 && <span className="absolute top-2 bottom-4 w-px bg-border" style={{ left: k * SLOT + GUT / 2 }} />}
      {gap >= PAUSE_MS && (
        <span className={cn("absolute top-[66px] -translate-x-1/2 rounded-full px-1 text-[10px] leading-[14px] font-medium tabular-nums",
          gap >= SLOW_MS ? "text-ink-(--orange)" : "text-tertiary")}
          style={{ left: k * SLOT + GUT / 2, background: gap >= SLOW_MS ? "color-mix(in srgb, var(--orange) 14%, var(--background))" : "var(--background)" }} data-web-replay-gap={gap}>{short(gap)}</span>
      )}
      {gap < PAUSE_MS && !page && k > 0 && <span className="absolute top-[73px] h-px w-2.5 -translate-x-1/2 bg-border" style={{ left: k * SLOT + GUT / 2 }} />}
      <button type="button" onClick={() => go(inside ? at : it.first)} aria-current={inside ? "step" : undefined}
        data-web-replay-step={it.first} data-failed={failed ? "" : undefined} data-folded={it.folded ? n : undefined}
        className="group absolute top-[34px] flex cursor-pointer flex-col text-left outline-none" style={{ left: k * SLOT + GUT, width: CARD }}>
        <span className="relative h-[80px] w-full">
          {it.folded && <>
            <span className="absolute -top-[6px] right-2 left-2 h-full rounded-[6px] bg-muted ring-[0.5px] ring-border" />
            <span className="absolute -top-[3px] right-1 left-1 h-full rounded-[6px] bg-muted ring-[0.5px] ring-border" />
          </>}
          <span className={cn("absolute inset-0 overflow-hidden rounded-[6px] bg-muted ring-[0.5px] ring-border transition-shadow",
            inside ? "ring-2 ring-primary" : "group-hover:ring-foreground/30 group-focus-visible:ring-2 group-focus-visible:ring-primary/50", failed && !inside && "ring-[1.5px] ring-(--red)")}>
            {src ? <img src={src} alt="" draggable={false} className={cn("size-full object-cover object-top", failed && "opacity-60")} />
              : src === null && <span className="grid size-full place-items-center"><k0.icon className="size-5" strokeWidth={1.75} style={{ color: kindOf(s).color }} /></span>}
            <span className="absolute top-1 left-1 grid size-[18px] place-items-center rounded-[5px] bg-background/92 shadow-sm">
              {(() => { const kk = kindOf(s); return <kk.icon className="size-3" strokeWidth={2.25} style={{ color: kk.color }} /> })()}
            </span>
            {it.folded && (
              <span role="button" tabIndex={-1} aria-label="Show each" data-tip="Show each"
                onClick={(e) => { e.stopPropagation(); fold(it.first) }}
                className="absolute right-1 bottom-1 rounded-[5px] bg-background/92 px-1.5 text-[11px] leading-[16px] font-semibold tabular-nums shadow-sm hover:bg-background">×{count(n)}</span>
            )}
          </span>
        </span>
        <span className={cn("mt-1.5 truncate text-[12px] leading-[16px]", inside ? "font-medium text-foreground" : "text-foreground/85", failed && "text-ink-(--red)")}>
          {it.folded ? verbOf(first.action) : said(s)}
        </span>
        <span className="truncate text-[11px] leading-[14px] text-tertiary tabular-nums">
          {it.folded ? (inside ? `${count(at - it.first + 1)} of ${count(n)}` : `${span(steps[it.last].t - first.t)}`) : time(s.t)}
        </span>
      </button>
    </>
  )
}
