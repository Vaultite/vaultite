// A lazy map of pins (MapLibre is big), same base map and controls as People → Map. Overlapping pins merge into a
// count; if the style can't load (offline, no WebGL) it calls onFail and the caller shows a list.
import { useEffect, useRef } from "react"
import { useNearScreen } from "@/core/near"
import { createRoot } from "react-dom/client"
import * as maplibregl from "maplibre-gl"
import type { Map as MLMap, Marker } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { Maximize2 } from "lucide-react"
import { followMapTheme, MAP_STYLE, mapTheme, restyleMap } from "@/core/mapstyle"
import { MapControls } from "@/components/MapControls"
import { namedIcon } from "@/core/pages"
import "./PinMap.css"

maplibregl.setWorkerUrl(workerUrl)

export type MapPin = { id: string; title: string; lat: number; lon: number; color?: string; icon?: string; meta?: string }
type Item = { key: string; lat: number; lon: number; pins: MapPin[] }

const R = 34 // px: pins closer than this merge
const PAD = { top: 56, bottom: 40, left: 40, right: 72 }
const DEFAULT_COLOR = "var(--indigo)"

/** Greedy screen-space grouping, densest spots first. */
function cluster(map: MLMap, pins: MapPin[]): Item[] {
  type Pt = { p: MapPin; x: number; y: number }
  const pts: Pt[] = pins.map((p) => ({ p, ...map.project([p.lon, p.lat]) }))
  const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < R
  const order = [...pts].sort((a, b) => pts.filter((q) => near(b, q)).length - pts.filter((q) => near(a, q)).length)
  const used = new Set<Pt>()
  const out: Item[] = []
  for (const seed of order) {
    if (used.has(seed)) continue
    const members = pts.filter((q) => !used.has(q) && near(seed, q))
    members.forEach((m) => used.add(m))
    const ps = members.map((m) => m.p)
    out.push({
      key: ps.map((p) => p.id).sort().join("\0"),
      lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lon: ps.reduce((s, p) => s + p.lon, 0) / ps.length, pins: ps,
    })
  }
  return out
}

const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function pinElement(it: Item) {
  const b = el("button", "nm-pin") as HTMLButtonElement
  b.type = "button"
  const one = it.pins.length === 1 ? it.pins[0] : null
  const colors = new Set(it.pins.map((p) => p.color ?? DEFAULT_COLOR))
  const dot = el("span", one ? "nm-dot" : "nm-dot nm-group", one ? undefined : String(it.pins.length))
  dot.style.setProperty("--c", colors.size === 1 ? [...colors][0] : DEFAULT_COLOR)
  const Icon = one?.icon ? namedIcon(one.icon) : null
  if (Icon) { dot.classList.add("nm-has-icon"); createRoot(dot).render(<Icon className="size-3.5" strokeWidth={2.5} />) }
  b.append(dot, el("span", "nm-label", one ? one.title : `${it.pins.length} files`))
  b.setAttribute("aria-label", one ? one.title : `${it.pins.length} files: ${it.pins.map((p) => p.title).join(", ")}`)
  b.dataset.pin = one ? one.id : ""
  return b
}

function popupContent(it: Item, onOpen: (id: string, newTab: boolean) => void, close: () => void) {
  const box = el("div", "nm-list")
  for (const p of it.pins) {
    const r = el("button", "nm-row") as HTMLButtonElement
    r.type = "button"
    const dot = el("span", "nm-row-dot")
    dot.style.setProperty("--c", p.color ?? DEFAULT_COLOR)
    const txt = el("span", "nm-row-text")
    txt.append(el("span", "nm-row-name", p.title), ...(p.meta ? [el("span", "nm-row-meta", p.meta)] : []))
    r.append(dot, txt)
    r.onclick = (e) => { close(); onOpen(p.id, e.metaKey || e.ctrlKey) }
    box.append(r)
  }
  return box
}

function boundsOf(points: { lat: number; lon: number }[]) {
  const b = new maplibregl.LngLatBounds()
  for (const p of points) b.extend([p.lon, p.lat])
  return b
}

export default function PinMap({ pins, onOpen, onFail, zoom }: {
  pins: MapPin[]; onOpen: (id: string, newTab: boolean) => void; onFail: () => void
  /** The most it zooms in to show every pin (default 11). */
  zoom?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const live = useRef({ pins, onOpen, onFail, zoom })
  live.current = { pins, onOpen, onFail, zoom }
  const redraw = useRef<(() => void) | null>(null)
  const fitAll = (animate = true) => {
    const map = mapRef.current, ps = live.current.pins, max = live.current.zoom ?? 11
    if (!map || !ps.length) return
    if (ps.length === 1) map.flyTo({ center: [ps[0].lon, ps[0].lat], zoom: Math.min(max, 11), animate })
    else map.fitBounds(boundsOf(ps), { padding: PAD, maxZoom: max, animate, duration: 700 })
  }

  // (made once it comes near the screen: core/near.ts)
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
        center: [0, 20], zoom: 1.5, minZoom: 1, maxZoom: 17,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: false,
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
      const items = cluster(map, live.current.pins)
      const keep = new Set(items.map((i) => i.key))
      for (const [k, m] of markers) if (!keep.has(k)) { m.remove(); markers.delete(k) }
      for (const it of items) {
        const known = markers.get(it.key)
        if (known) { known.setLngLat([it.lon, it.lat]); continue }
        const node = pinElement(it)
        node.addEventListener("click", (e) => {
          e.stopPropagation()
          closePopup()
          if (it.pins.length === 1) return live.current.onOpen(it.pins[0].id, e.metaKey || e.ctrlKey)
          const b = boundsOf(it.pins)
          const spread = b.getNorthEast().distanceTo(b.getSouthWest())
          if (spread > 200 && map.getZoom() < 15) {
            map.fitBounds(b, { padding: PAD, maxZoom: Math.max(map.getZoom() + 2, 12), duration: 650 })
            return
          }
          popup = new maplibregl.Popup({ closeButton: false, className: "nm-popup", maxWidth: "280px", offset: 18 })
            .setLngLat([it.lon, it.lat]).setDOMContent(popupContent(it, live.current.onOpen, closePopup)).addTo(map)
        })
        markers.set(it.key, new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([it.lon, it.lat]).addTo(map))
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

  // Pins change (a file was edited while the map was open): redraw them.
  useEffect(() => { redraw.current?.() }, [pins])

  return (
    <div className="relative h-full w-full" data-pin-map>
      <div ref={box} className="nm-map h-full w-full" />
      <MapControls map={mapRef} extra={[{ label: "Show every pin", icon: Maximize2, run: () => fitAll() }]} />
    </div>
  )
}
