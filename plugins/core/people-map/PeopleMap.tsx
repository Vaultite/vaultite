// The People map, lazily loaded (MapLibre is big): avatar pins by relation, merging when they overlap; "You" is the
// blue dot. If the style can't load it calls onFail and the page shows the list only.
import { useEffect, useRef } from "react"
import * as maplibregl from "maplibre-gl"
import type { Map as MLMap, Marker } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { LocateFixed, Maximize2 } from "lucide-react"
import { followMapTheme, MAP_STYLE, MapControls, mapTheme, restyleMap, useNearScreen } from "@vaultite"
import type { Person } from "@plugins/core/people/types"
import { colorOf, firstName, initials, regionOf, type Me } from "./places"
import "./PeopleMap.css"

maplibregl.setWorkerUrl(workerUrl)

type P = Person & { lat: number; lon: number }
type Item = { key: string; lat: number; lon: number; people: P[]; me: boolean }
export type Focus = { points: [number, number][]; seq: number } | null

const R = 46 // px: pins closer than this merge into a group
const PAD = { top: 76, bottom: 40, left: 40, right: 40 }

/** Greedy screen-space grouping, densest spots first. "You" joins a group when it overlaps one. */
function cluster(map: MLMap, people: P[], me: Me | null): Item[] {
  type Pt = { p: P | null; x: number; y: number; lat: number; lon: number }
  const pts: Pt[] = people.map((p) => ({ p, lat: p.lat, lon: p.lon, ...map.project([p.lon, p.lat]) }))
  if (me) pts.push({ p: null, lat: me.lat, lon: me.lon, ...map.project([me.lon, me.lat]) })
  const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < R
  const order = [...pts].sort((a, b) => pts.filter((q) => near(b, q)).length - pts.filter((q) => near(a, q)).length)
  const used = new Set<Pt>()
  const out: Item[] = []
  for (const seed of order) {
    if (used.has(seed)) continue
    const members = pts.filter((q) => !used.has(q) && near(seed, q))
    members.forEach((m) => used.add(m))
    const ps = members.flatMap((m) => (m.p ? [m.p] : []))
    const hasMe = members.some((m) => !m.p)
    // A group sits on its people, not on you (the blue dot peeks from under the pin).
    const anchor = ps.length ? members.filter((m) => m.p) : members
    out.push({
      key: [...ps.map((p) => p.id).sort(), hasMe ? "me" : ""].join(","),
      lat: anchor.reduce((s, m) => s + m.lat, 0) / anchor.length,
      lon: anchor.reduce((s, m) => s + m.lon, 0) / anchor.length,
      people: ps, me: hasMe,
    })
  }
  return out
}

function groupLabel(it: Item) {
  const locs = new Set(it.people.map((p) => p.location))
  if (locs.size === 1) return [...locs][0].split(",")[0]
  const regions = new Set(it.people.map((p) => regionOf(p.lat, p.lon, p.location)))
  if (regions.size === 1) return [...regions][0]
  return it.people.length === 2 ? it.people.map((p) => firstName(p.name)).join(" and ") : `${it.people.length} people`
}

const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function avatar(name: string, color: string, cls = "pm-avatar") {
  const a = el("span", cls, initials(name))
  a.style.setProperty("--c", color)
  return a
}

/** A mixed group's bubble: one slice per relation, sized by how many people it has, biggest first. Past four
    colours it stops reading, so the smallest ones merge into a grey "others" slice. */
function slices(people: P[]) {
  const n = new Map<string, number>()
  for (const p of people) n.set(colorOf(p.relation), (n.get(colorOf(p.relation)) ?? 0) + 1)
  let parts = [...n].sort((a, b) => b[1] - a[1])
  if (parts.length > 4) parts = [...parts.slice(0, 3), ["#8e8e93", parts.slice(3).reduce((s, [, c]) => s + c, 0)]]
  let at = 0
  const stops = parts.map(([c, k]) => {
    const from = (at / people.length) * 360
    at += k
    return `${c} ${from}deg ${(at / people.length) * 360}deg`
  })
  return `conic-gradient(${stops.join(", ")})`
}

function pinElement(it: Item) {
  const b = el("button", "pm-pin") as HTMLButtonElement
  b.type = "button"
  if (!it.people.length) { // just you
    b.classList.add("pm-pin-me")
    b.append(el("span", "pm-me"), el("span", "pm-label", "You"))
    b.setAttribute("aria-label", "You")
    return b
  }
  const one = it.people.length === 1 ? it.people[0] : null
  const rel = new Set(it.people.map((p) => p.relation))
  const bubble = one ? avatar(one.name, colorOf(one.relation), "pm-bubble")
    : el("span", "pm-bubble pm-group", String(it.people.length))
  if (!one) {
    bubble.style.setProperty("--c", rel.size === 1 ? colorOf([...rel][0]) : "var(--people)")
    if (rel.size > 1) bubble.style.background = slices(it.people)
  }
  if (it.me) bubble.append(el("span", "pm-me-badge"))
  b.append(bubble, el("span", "pm-tail"), el("span", "pm-label", one ? firstName(one.name) : groupLabel(it)))
  b.setAttribute("aria-label", one ? `${one.name}, ${one.location}` : `${groupLabel(it)}: ${it.people.map((p) => p.name).join(", ")}`)
  return b
}

function popupContent(it: Item, me: Me | null, onOpen: (id: string) => void, close: () => void) {
  const box = el("div", "pm-list")
  if (it.me && me) {
    const r = el("div", "pm-row")
    const dot = el("span", "pm-avatar pm-avatar-me")
    const txt = el("span", "pm-row-text")
    txt.append(el("span", "pm-row-name", "You"), el("span", "pm-row-meta", me.location))
    r.append(dot, txt)
    box.append(r)
  }
  for (const p of it.people) {
    const r = el("button", "pm-row pm-row-btn") as HTMLButtonElement
    r.type = "button"
    const txt = el("span", "pm-row-text")
    txt.append(el("span", "pm-row-name", p.name), el("span", "pm-row-meta", p.location))
    r.append(avatar(p.name, colorOf(p.relation)), txt, el("span", "pm-chevron"))
    r.onclick = () => { close(); onOpen(p.id) }
    box.append(r)
  }
  return box
}

function boundsOf(points: [number, number][]) {
  const b = new maplibregl.LngLatBounds()
  for (const [lat, lon] of points) b.extend([lon, lat])
  return b
}

export default function PeopleMap({ people, me, onOpen, onFail, focus }: {
  people: P[]; me: Me | null; onOpen: (id: string) => void; onFail: () => void; focus: Focus
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const all: [number, number][] = [...people.map((p): [number, number] => [p.lat, p.lon]), ...(me ? [[me.lat, me.lon] as [number, number]] : [])]
  const fitAll = (animate = true) => {
    const map = mapRef.current
    if (!map || !all.length) return
    if (all.length === 1) map.flyTo({ center: [all[0][1], all[0][0]], zoom: 9, animate })
    else map.fitBounds(boundsOf(all), { padding: PAD, maxZoom: 9, animate, duration: 700 })
  }
  // Latest props for the map's event handlers, which are bound once.
  const live = useRef({ people, me, onOpen, onFail })
  live.current = { people, me, onOpen, onFail }
  const redraw = useRef<(() => void) | null>(null)

  // (made once it comes near the screen)
  const near = useNearScreen(box)
  useEffect(() => {
    if (!box.current || !near) return
    let map: MLMap
    let styled = false
    let t = mapTheme()
    const fail = () => { if (!styled) live.current.onFail() }
    try {
      map = new maplibregl.Map({
        container: box.current, style: MAP_STYLE[t], renderWorldCopies: false,
        center: [-98.5, 39.5], zoom: 2.6, minZoom: 1.5, maxZoom: 16,
        dragRotate: false, pitchWithRotate: false, touchPitch: false,
        attributionControl: { compact: true },
      })
    } catch {
      live.current.onFail()
      return
    }
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    const timer = setTimeout(fail, 12000)
    map.on("error", fail)
    map.on("style.load", () => { styled = true; clearTimeout(timer); restyleMap(map, t) })
    const unfollow = followMapTheme(map, (nt) => { t = nt })

    // Markers, diffed by group key so pins don't flash when the zoom changes.
    const markers = new Map<string, Marker>()
    let popup: maplibregl.Popup | null = null
    const closePopup = () => { popup?.remove(); popup = null }
    const render = () => {
      const { people, me } = live.current
      const items = cluster(map, people, me)
      const keep = new Set(items.map((i) => i.key))
      for (const [k, m] of markers) if (!keep.has(k)) { m.remove(); markers.delete(k) }
      for (const it of items) {
        const known = markers.get(it.key)
        if (known) { known.setLngLat([it.lon, it.lat]); continue }
        const node = pinElement(it)
        const onlyMe = !it.people.length
        node.addEventListener("click", (e) => {
          e.stopPropagation()
          closePopup()
          const { me, onOpen } = live.current
          if (it.people.length === 1 && !it.me) return onOpen(it.people[0].id)
          const pts: [number, number][] = [...it.people.map((p): [number, number] => [p.lat, p.lon]), ...(it.me && me ? [[me.lat, me.lon] as [number, number]] : [])]
          const b = boundsOf(pts)
          const spread = b.getNorthEast().distanceTo(b.getSouthWest())
          if (!onlyMe && spread > 1500 && map.getZoom() < 12) {
            map.fitBounds(b, { padding: PAD, maxZoom: Math.max(map.getZoom() + 2, 10), duration: 650 })
            return
          }
          const lift = onlyMe ? 16 : 54
          popup = new maplibregl.Popup({
            closeButton: false, className: "pm-popup", maxWidth: "280px",
            offset: { top: [0, onlyMe ? 16 : 22], bottom: [0, -lift], left: [24, -lift / 2], right: [-24, -lift / 2],
              "top-left": [8, 8], "top-right": [-8, 8], "bottom-left": [8, -lift], "bottom-right": [-8, -lift], center: [0, 0] },
          }).setLngLat([it.lon, it.lat]).setDOMContent(popupContent(it, me, onOpen, closePopup)).addTo(map)
        })
        const m = new maplibregl.Marker({ element: node, anchor: onlyMe ? "center" : "bottom" }).setLngLat([it.lon, it.lat]).addTo(map)
        if (onlyMe || it.me) m.addClassName(onlyMe ? "pm-layer-me" : "pm-layer-top")
        markers.set(it.key, m)
      }
    }
    map.on("load", () => {
      fitAll(false); render(); redraw.current = render
      // The compact attribution starts expanded; keep it to its small "i" until tapped.
      box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
    })
    map.on("zoomend", render)
    map.on("resize", render)

    return () => { clearTimeout(timer); unfollow(); map.remove(); mapRef.current = null; redraw.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near])

  // People change (Claude wrote something while the page was open): redraw pins.
  useEffect(() => { redraw.current?.() }, [people, me])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus?.points.length) return
    if (focus.points.length === 1) map.flyTo({ center: [focus.points[0][1], focus.points[0][0]], zoom: 10, duration: 800 })
    else map.fitBounds(boundsOf(focus.points), { padding: PAD, maxZoom: 11, duration: 800 })
  }, [focus])

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="pm-map h-full w-full" />
      <MapControls map={mapRef} extra={[
        { label: "Show everyone", icon: Maximize2, run: () => fitAll() },
        ...(me ? [{ label: "Show where you are", icon: LocateFixed, run: () => mapRef.current?.flyTo({ center: [me.lon, me.lat], zoom: 10, duration: 800 }) }] : []),
      ]} />
    </div>
  )
}
