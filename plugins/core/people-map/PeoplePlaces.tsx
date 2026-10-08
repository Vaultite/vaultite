// ```block-people-map: the lazy map plus the same people grouped by place, which works alone if the map can't load.
// `places: false` leaves the list out.
import { Component, lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight, MapPin, MapPinOff } from "lucide-react"
import { cn, detailPath, Empty, isArchived, List, openDetail, Panel, type Store } from "@vaultite"
import type { Person } from "@plugins/core/people/types"
import { colorOf, initials, located, meOf, placesOf, RELATIONS, YOU_COLOR, type Place } from "./places"
import type { Focus } from "./PeopleMap"

const PeopleMap = lazy(() => import("./PeopleMap"))
const TINT = "var(--people)"

/** A failed chunk import (or a crash inside MapLibre) falls back to the list instead of taking the page down. */
class MapBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFail() }
  render() { return this.state.failed ? null : this.props.children }
}

export function Avatar({ name, relation, size = 30 }: { name: string; relation: string; size?: number }) {
  const c = colorOf(relation)
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-semibold text-white num"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(180deg, color-mix(in srgb, ${c} 70%, #fff), ${c})` }}>
      {initials(name)}
    </span>
  )
}

function YouDot() {
  return (
    <span aria-hidden className="grid size-[30px] shrink-0 place-items-center">
      <span className="size-[14px] rounded-full border-[2.5px] border-white shadow-[0_0_0_5px_rgb(0_122_255/0.16)]" style={{ background: YOU_COLOR }} />
    </span>
  )
}

/** "Austin, TX" -> "Austin"; "Brooklyn, New York, NY" -> "Brooklyn, New York". */
const shortPlace = (s: string | null | undefined) => (s ?? "").replace(/,\s*[A-Z]{2}$/, "")

function PersonRow({ p }: { p: Person }) {
  return (
    <button type="button" onClick={() => openDetail(detailPath("person", p.id))}
      className={cn(
        "relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-1.5 text-left",
        "before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] before:transition-colors",
        "hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07]",
      )}>
      <Avatar name={p.name} relation={p.relation} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px]">{p.name}</div>
        {p.moving_to && <div className="line-clamp-2 text-[13px] text-muted-foreground">Moving to {p.moving_to}</div>}
      </div>
      <span className="max-w-[45%] shrink-0 truncate text-right text-[14px] text-muted-foreground">{shortPlace(p.location)}</span>
      <ChevronRight className="-ml-1.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </button>
  )
}

export function PeoplePlaces({ store, list = true }: { store: Store; list?: boolean }) {
  const mapRef = useRef<HTMLElement>(null)
  const people = useMemo(() => store.people.filter((p) => !isArchived(p)), [store.people])
  const me = meOf(store)
  const onMap = useMemo(() => people.filter(located), [people])
  const places = placesOf(people, me)
  const missing = people.filter((p) => !located(p))
  const [failed, setFailed] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const relations = RELATIONS.filter((r) => onMap.some((p) => p.relation === r.id))

  const show = (pl: Place) => {
    const points: [number, number][] = pl.people.map((p) => [p.lat, p.lon])
    if (pl.me && me) points.push([me.lat, me.lon])
    setFocus((f) => ({ points, seq: (f?.seq ?? 0) + 1 }))
    // The map is above the list: bring it back into view.
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {failed ? (
        <Panel title="Map unavailable" icon={MapPinOff} tint={TINT}>
          <Empty>The map couldn't load, maybe you're offline. Everyone is still listed by place.</Empty>
        </Panel>
      ) : (
        <section ref={mapRef} className="glass scroll-mt-14 overflow-hidden rounded-[12px]">
          <div className="h-[min(56dvh,560px)] min-h-[320px] md:h-[min(60dvh,520px)]">
            <MapBoundary onFail={() => setFailed(true)}>
              <Suspense fallback={<div className="pm-map h-full w-full bg-muted" />}>
                <PeopleMap people={onMap} me={me} focus={focus} onFail={() => setFailed(true)}
                  onOpen={(id) => openDetail(detailPath("person", id))} />
              </Suspense>
            </MapBoundary>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] text-muted-foreground">
            {me && <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: YOU_COLOR }} />You</span>}
            {relations.map((r) => (
              <span key={r.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: r.color }} />{r.label}</span>
            ))}
          </div>
        </section>
      )}

      {list && <Panel title="By place" icon={MapPin} tint={TINT}>
        {!places.length && <Empty>Nobody has a location yet. Tell Claude where people live.</Empty>}
        {/* One column on phones; on wider screens the places flow into columns, like an index. */}
        <div className="gap-8 md:columns-2">
          {places.map((pl) => (
            <div key={pl.name} className="mb-4 break-inside-avoid">
              <div className="flex min-h-9 items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-[15px] font-semibold">
                  {pl.name}<span className="ml-1.5 font-normal text-muted-foreground num">{pl.people.length}</span>
                </h3>
                {!failed && (
                  <button type="button" onClick={() => show(pl)} aria-label={`Show ${pl.name} on the map`}
                    className="-mr-2 min-h-9 shrink-0 cursor-pointer rounded-[8px] px-2 text-[15px] text-primary hover:bg-foreground/[0.04] active:bg-foreground/[0.07]">
                    Show
                  </button>
                )}
              </div>
              <List>
                {pl.me && me && (
                  <div className="flex min-h-11 items-center gap-3 py-1.5">
                    <YouDot />
                    <span className="flex-1 text-[15px]">You</span>
                    <span className="max-w-[55%] truncate text-right text-[14px] text-muted-foreground">{me.location.split(",")[0]}</span>
                  </div>
                )}
                {pl.people.map((p) => <PersonRow key={p.id} p={p} />)}
              </List>
            </div>
          ))}
          {/* Rows like every place's (a location that wasn't found shows as it's written). */}
          {!!missing.length && (
            <div className="mb-4 break-inside-avoid">
              <div className="flex min-h-9 items-center">
                <h3 className="min-w-0 truncate text-[15px] font-semibold">
                  Not on the map<span className="ml-1.5 font-normal text-muted-foreground num">{missing.length}</span>
                </h3>
              </div>
              <List>{missing.map((p) => <PersonRow key={p.id} p={p} />)}</List>
            </div>
          )}
        </div>
      </Panel>}
    </div>
  )
}
