// The queue block: what the inbox holds to watch, listen to or read, with how far you got. Play starts it in the mini
// player; Done files it away as the inbox's Done does.
import { useState, type MouseEvent } from "react"
import { BookOpen, Check, CheckCheck, Globe, ListVideo, Pause, Play, RotateCcw } from "lucide-react"
import { cn, Empty, fmtAgo, isArchived, List, menuFor, notifyError, op, openFile, Panel, rawUrl, resolver, Row, Segmented, SwipeRow, type Store, type SwipeAction } from "@vaultite"
import { leftText, shelfOf, type Place, type Shelf } from "./shelves"
import { getNow, pictureOf, playFile, markDone, useNow, usePlaces, useTick } from "./now"

type Entry = { id: string; note: string; title: string; shelf: Shelf; media: string | null; source: string; from: string; created: string | null }
type Show = "all" | Shelf

function entries(store: Store): Entry[] {
  const find = resolver(store)
  const inbox = ((store as { inbox?: { id: string; title: string; status: string; body: string; source: string; from: string; created: string | null; archived?: boolean }[] }).inbox ?? [])
  return inbox.filter((r) => r.status === "new" && !isArchived(r)).flatMap((r) => {
    const s = shelfOf(r)
    if (!s) return []
    const note = `${r.id}.md`
    return [{ id: r.id, note, title: r.title, shelf: s.shelf, media: s.media ? find(s.media, note)?.file ?? null : null, source: r.source, from: r.from, created: r.created }]
  })
}

/** Books being read (the Books plugin's, when it's on): the Read shelf's too. */
function books(store: Store) {
  const list = (store as { books?: { id: string; title: string; author: string; status: string; current_page: number | null; total_pages: number | null; archived?: boolean }[] }).books ?? []
  return list.filter((b) => b.status === "reading" && !isArchived(b))
}

const LABELS: Record<Show, string> = { all: "All", watch: "Watch", listen: "Listen", read: "Read" }

export function QueueBlock({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const fixed = (["watch", "listen", "read"] as string[]).includes(String(options.show)) ? options.show as Shelf : null
  const [pick, setPick] = useState<Show>("all")
  const show = fixed ?? pick
  const places = usePlaces()
  useNow()
  const all = entries(store)
  const reading = books(store)
  // Started first (most recent first), then the newest.
  const started = (e: Entry) => (e.media && places[e.media] && !places[e.media].done && places[e.media].t > 5 ? places[e.media].at : 0)
  const list = all.filter((e) => show === "all" || e.shelf === show)
    .sort((a, b) => started(b) - started(a) || String(b.created ?? "").localeCompare(String(a.created ?? "")))
  const count = (k: Show) => (k === "all" ? all.length + reading.length : all.filter((e) => e.shelf === k).length + (k === "read" ? reading.length : 0))
  const withBooks = show === "all" || show === "read"
  return (
    <Panel title="Queue" icon={ListVideo}>
      {!fixed && (
        <Segmented label="Show" value={pick} onChange={setPick} className="mb-3"
          options={(["all", "watch", "listen", "read"] as Show[]).map((k) => ({ value: k, label: count(k) ? `${LABELS[k]} ${count(k)}` : LABELS[k] }))} />
      )}
      {!list.length && !(withBooks && reading.length) ? (
        <Empty>{show === "all" ? "Nothing waiting. Saved videos, podcasts and pages land here." : `Nothing to ${LABELS[show].toLowerCase()}.`}</Empty>
      ) : (
        <List>
          {withBooks && reading.map((b) => {
            const pct = b.total_pages ? Math.min(100, Math.round(((b.current_page ?? 0) / b.total_pages) * 100)) : null
            return (
              <div key={b.id}>
                <Row title={b.title} meta={[b.author, pct !== null ? `${pct}%` : "reading"].filter(Boolean).join(" · ")} onOpen={() => openFile(`${b.id}.md`)}
                  lead={<Thumb icon={BookOpen} />} />
                {pct !== null && <Bar pct={pct} />}
              </div>
            )
          })}
          {list.map((e) => <QueueRow key={e.id} e={e} place={e.media ? places[e.media] : undefined} />)}
        </List>
      )}
    </Panel>
  )
}

function Thumb({ pic, icon: Icon, wide }: { pic?: string | null; icon: typeof Globe; wide?: boolean }) {
  return pic ? <img src={rawUrl(pic)} alt="" draggable={false} loading="lazy" className={cn("shrink-0 rounded-[6px] bg-muted object-cover", wide ? "h-10 w-[71px]" : "size-10")} />
    : <div className={cn("grid shrink-0 place-items-center rounded-[6px] bg-muted", wide ? "h-10 w-[71px]" : "size-10")}><Icon className="size-5 text-muted-foreground" strokeWidth={1.75} /></div>
}

const Bar = ({ pct }: { pct: number }) => (
  <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
)

function QueueRow({ e, place }: { e: Entry; place?: Place }) {
  const now = getNow()
  const playing = !!e.media && now?.path === e.media
  useTick(playing ? now!.el : null)
  const t = playing ? now!.el.currentTime : place?.t ?? 0
  const d = playing && Number.isFinite(now!.el.duration) ? now!.el.duration : place?.d
  const live: Place | undefined = playing ? { t, d, at: Date.now() } : place
  const pct = d && t > 5 && !place?.done ? Math.min(100, (t / d) * 100) : null
  const done = () => op("inbox.done", { path: e.note }).catch((err) => notifyError(err, "Couldn't mark it done"))
  const toggle = () => {
    if (!e.media) return
    if (playing) { if (now!.el.paused) void now!.el.play(); else now!.el.pause() } else playFile(e.media, e.note)
  }
  const swipe = (): SwipeAction[] => [
    ...(e.media ? [{ label: place?.done ? "Unplayed" : "Played", icon: place?.done ? RotateCcw : CheckCheck, run: () => markDone(e.media!, !place?.done) }] : []),
    { label: "Done", icon: Check, run: done, removes: true },
  ]
  const menu = menuFor(() => [
    { label: "Open", run: () => openFile(e.note) },
    ...(e.source && /^https?:/.test(e.source) ? [{ label: "Open the page", icon: Globe, run: () => void window.open(e.source, "_blank", "noopener") }] : []),
    ...(e.media ? [{ label: place?.done ? "Mark as unplayed" : "Mark as played", icon: place?.done ? RotateCcw : CheckCheck, run: () => markDone(e.media!, !place?.done) }] : []),
    { label: "Done", icon: Check, run: done },
  ])
  const meta = [e.from, e.media ? leftText(live) : e.created ? fmtAgo(e.created) : ""].filter(Boolean).join(" · ")
  const Icon = e.shelf === "read" ? Globe : ListVideo
  return (
    <SwipeRow actions={swipe} data-queue-row={e.id}>
      <div onContextMenu={menu as unknown as (ev: MouseEvent) => void}>
        <Row title={e.title} meta={meta} onOpen={() => openFile(e.note)} lead={<Thumb pic={e.media ? pictureOf(e.media) : null} icon={Icon} wide={e.shelf === "watch"} />}
          right={e.media ? (
            <span role="button" tabIndex={0} aria-label={playing && !now!.el.paused ? "Pause" : "Play"}
              onClick={(ev) => { ev.stopPropagation(); toggle() }} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); toggle() } }}
              className="grid size-11 cursor-pointer place-items-center rounded-full text-foreground hover:bg-foreground/[0.06] md:size-8">
              {playing && !now!.el.paused ? <Pause className="size-5 fill-current md:size-4" strokeWidth={0} /> : <Play className="size-5 fill-current md:size-4" strokeWidth={0} />}
            </span>
          ) : undefined} />
        {pct !== null && <Bar pct={pct} />}
      </div>
    </SwipeRow>
  )
}
