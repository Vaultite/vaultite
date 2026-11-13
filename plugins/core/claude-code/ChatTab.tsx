import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, History } from "lucide-react"
import { glide, moves, notifyError, trackSoon, useDesktop } from "@vaultite"
import "./chat.css"
import { type Driven, drivenOf } from "./driven"
import { nameTab, NEW } from "./titles"
import { useChat } from "./useChat"
import { type Ask, useOptions, clipLine } from "./chatbits"
import { layout, Status, TurnView, TranscriptOf, type Transcript } from "./Entries"
import { Composer, type Queued } from "./Composer"
import { Head, Welcome, Skeleton, Kinfolk, Failed, Away, Unread } from "./Head"
import { knowChat } from "./chatmenu"


export function ChatView({ id, setArg }: { id: string; setArg: (arg: string) => void }) {
  return <Chat key={id === NEW ? NEW : id} id={id} setArg={setArg} />
}

function Chat({ id, setArg }: { id: string; setArg: (arg: string) => void }) {
  const c = useChat(id)
  const d = drivenOf(c.driven)
  const [chat, setChat] = useState(false)
  useEffect(() => { if (d?.title && !c.title) nameTab(id, d.title) }, [d?.title, c.title, c.ready]) // eslint-disable-line react-hooks/exhaustive-deps
  if (d?.View && !chat) return <Suspense fallback={null}><d.View id={id} c={c} chat={() => setChat(true)} /></Suspense>
  return <ChatOf id={id} setArg={setArg} c={c} d={d} back={d?.View ? () => setChat(false) : undefined} />
}

function ChatOf({ id, setArg, c, d, back }: { id: string; setArg: (arg: string) => void; c: ReturnType<typeof useChat>; d: Driven | null; back?: () => void }) {
  const fresh = !id || id === NEW
  const o = useOptions()
  const desktop = useDesktop()
  const f = useFollow(c.ready)
  const working = c.s?.state === "working" || c.s?.state === "starting"
  const live = working || c.s?.state === "waiting"
  const pending = c.entries.filter((e): e is Ask => e.k === "ask" && !e.answer && !!c.s?.asks.includes(e.id))
  useEffect(() => {
    if (fresh) return
    knowChat(id, { ready: c.ready, running: !!c.s, busy: c.s?.state === "working" || c.s?.state === "waiting", tui: c.tui, driven: !!c.driven })
  }, [id, fresh, c.ready, c.s, c.tui, c.driven])
  useEffect(() => () => knowChat(id, null), [id])

  const [sentQueued, setSentQueued] = useState<Queued[]>([])
  const queued = !working ? [] : sentQueued.filter((q) => {
    let at = -1
    for (let n = c.entries.length - 1; n >= 0; n--) { const e = c.entries[n]; if (e.id === q.id || (e.k === "user" && e.text === q.text)) { at = n; break } }
    return at < 0 || c.entries.slice(at + 1).every((e) => e.k === "user")
  })

  const [opened, setOpened] = useState<Map<string, boolean>>(() => new Map())
  const [seen] = useState(() => new Set<string>())
  const settled = useRef(false)
  useEffect(() => { if (!c.ready) return; const t = setTimeout(() => { settled.current = true }, 600); return () => clearTimeout(t) }, [c.ready])
  const transcript = useMemo<Transcript>(() => ({
    cwd: c.cwd, home: o?.home, seen, settled: () => settled.current,
    isOpen: (k, dflt) => opened.get(k) ?? dflt,
    toggle: (k, dflt) => { f.hold(); setOpened((m) => new Map(m).set(k, !(m.get(k) ?? dflt))) },
  }), [c.cwd, o?.home, opened]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { f.follow() }, [c.entries, c.s?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const away = [...pending.map((p) => p.id), ...queued.map((q) => c.entries.findLast((e) => e.id === q.id || (e.k === "user" && e.text === q.text))?.id ?? "")].join(",")
  const { turns, kids } = useMemo(() => layout(c.entries, new Set(away.split(","))), [c.entries, away])
  const first = c.entries.find((e) => e.k === "user")
  const said = first?.k === "user" ? clipLine(first.text) || (first.images?.length ? "Pictures" : "") : ""
  const title = fresh ? "New chat" : c.title || d?.title || said || (c.ready ? "Untitled chat" : "")
  useEffect(() => { if (!c.title && !d?.title && said && !fresh) nameTab(id, said) }, [first?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const askedAt = turns.at(-1)?.user?.at
  const lastEnded = !!turns.at(-1)?.ended
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!live || !lastEnded) return
    const off = trackSoon("the turn's status", () => true), t = setTimeout(() => { off(); setLate(true) }, 1500)
    return () => { off(); clearTimeout(t) }
  }, [live, lastEnded])
  const going = live && (!lastEnded || late)
  const status = going && c.s ? <Status entries={c.entries} since={askedAt ? Date.parse(askedAt) : c.s.at} state={c.s.state} asking={pending.length > 0} /> : null
  const composer = <Composer id={id} fresh={fresh} c={c} o={o} asks={pending} working={working} queued={queued} setArg={setArg}
    onSent={(m) => { f.stick(); if (m.queued) setSentQueued([...queued, { id: m.uuid ?? "", text: m.text }]) }} />
  if (fresh) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background" data-chat="new" data-state="new">
        <div className="chat-fresh isolate flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4">
          <div className="chat-fresh-in m-auto w-full chat-column">{desktop ? <Welcome><div className="-mx-4">{composer}</div></Welcome> : <Welcome />}</div>
        </div>
        {!desktop && composer}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-chat={id} data-state={c.s?.state ?? (c.tui !== null ? "terminal" : "closed")}>
      <Head id={id} title={title} c={c} o={o} scrolled={f.scrolled} back={back && { name: d?.name ?? "Timeline", go: back }} />
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={f.scroller} onScroll={f.onScroll} className="isolate min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={f.content} className="chat-talk mx-auto w-full chat-column px-5 pt-5 pb-8 max-md:px-4">
          {!c.ready ? <Skeleton note={c.unreachable} retry={c.retry} /> : c.failed && !c.entries.length ? <Unread id={id} retry={c.retry} /> : !c.found ? <p className="py-10 text-center text-[15px] text-muted-foreground">This session isn't on this machine, or it's in a private account.</p> : (
            <>
              <Kinfolk id={id} state={c.s?.state ?? ""} />
              {c.start > 0 && (
                <button type="button" onClick={() => void c.earlier().catch((e) => notifyError(e, "Couldn't read the earlier messages"))}
                  className="mb-5 flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground max-md:h-11 max-md:text-[15px]">
                  <History className="size-4" strokeWidth={2} />Show earlier messages
                </button>
              )}
              <TranscriptOf.Provider value={transcript}>
                <div className="flex flex-col gap-8" data-entries>
                  {turns.map((t, n) => <TurnView key={t.key} t={t} kids={kids} live={going && n === turns.length - 1} id={id} pending={pending} Message={d?.Message}
                    status={going && n === turns.length - 1 ? status : undefined} />)}
                  {going && !turns.length && status}
                </div>
              </TranscriptOf.Provider>
              {c.s?.state === "error" && c.s.error && <div className="mt-5"><Failed id={id} error={c.s.error} c={c} /></div>}
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="chat-scrim" data-on={f.away || undefined} />
      <button type="button" onClick={f.jump} aria-label="Jump to latest" data-tip="Jump to latest" data-jump-latest={f.away || undefined} tabIndex={f.away ? 0 : -1} aria-hidden={!f.away}
        className="chat-jump grid size-8 cursor-pointer place-items-center rounded-full border-[0.5px] border-border bg-card text-muted-foreground hover:text-foreground max-md:size-11">
        <ArrowDown className="size-4 max-md:size-5" strokeWidth={2.25} />
      </button>
      </div>
      {c.ready && (c.unreachable || (c.failed && c.entries.length > 0)) && <Away text={c.unreachable || "Couldn't read this chat. Trying again…"} />}
      {composer}
    </div>
  )
}

function useFollow(ready: boolean) {
  const scroller = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null)
  const stuck = useRef(true), mine = useRef(-1), frame = useRef(0), held = useRef(0), began = useRef(false)
  const [away, setAway] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const set = (el: HTMLElement, top: number) => { el.scrollTop = top; mine.current = el.scrollTop }
  const follow = () => {
    const el = scroller.current
    if (!el || !stuck.current || Date.now() < held.current) return
    const goal = el.scrollHeight - el.clientHeight
    if (!began.current || !moves()) { if (ready) began.current = true; set(el, goal); return }
    if (frame.current) return
    const step = () => {
      frame.current = 0
      const to = el.scrollHeight - el.clientHeight, d = to - el.scrollTop
      if (!stuck.current || (mine.current >= 0 && Math.abs(el.scrollTop - mine.current) > 2)) return
      if (d <= 1) { if (d > 0) set(el, to); return }
      set(el, el.scrollTop + Math.max(1, d * 0.18))
      frame.current = requestAnimationFrame(step)
    }
    mine.current = el.scrollTop
    frame.current = requestAnimationFrame(step)
  }
  useEffect(() => {
    const el = content.current
    if (!el) return
    const ro = new ResizeObserver(() => { follow(); const s = scroller.current; if (s) setAway(!stuck.current && s.scrollHeight - s.scrollTop - s.clientHeight > 240) })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current) }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    setScrolled(el.scrollTop > 4)
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (Math.abs(el.scrollTop - mine.current) >= 2) stuck.current = gap < 80
    setAway(!stuck.current && gap > 240)
  }
  return {
    scroller, content, away, scrolled, onScroll, follow,
    hold: () => { held.current = Date.now() + 450 },
    stick: () => { stuck.current = true; held.current = 0 },
    jump: () => { const el = scroller.current; if (!el) return; stuck.current = true; setAway(false); el.scrollTo({ top: el.scrollHeight, behavior: glide() }) },
  }
}
