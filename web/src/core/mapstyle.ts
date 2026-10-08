// How the app's maps look: OpenFreeMap vector tiles (free, no key) recoloured to the scheme with quiet labels. Types
// only: maps load MapLibre in their own chunk.
import type { Map as MLMap } from "maplibre-gl"

export type MapTheme = "light" | "dark"
export const MAP_STYLE: Record<MapTheme, string> = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" }

// Apple Maps-ish palette over the stock styles (layers that don't exist are skipped).
const PAINT: Record<MapTheme, Record<string, Record<string, string>>> = {
  light: {
    background: { "background-color": "#f6f4ef" },
    water: { "fill-color": "#aed3f3" },
    waterway: { "line-color": "#aed3f3" },
    park: { "fill-color": "#d8eccb" },
    landcover_wood: { "fill-color": "#dfeed5" },
    landuse_residential: { "fill-color": "#f0eee8" },
    boundary_2: { "line-color": "#bdb8ae" },
    boundary_3: { "line-color": "#d3cfc6" },
  },
  dark: {
    background: { "background-color": "#242426" },
    landcover_ice_shelf: { "fill-color": "#2c2c2e" },
    landcover_glacier: { "fill-color": "#2c2c2e" },
    water: { "fill-color": "#1a2a3e" },
    waterway: { "line-color": "#1a2a3e" },
    landuse_park: { "fill-color": "#243029" },
    landcover_wood: { "fill-color": "#243029" },
    landuse_residential: { "fill-color": "#2a2a2c" },
    building: { "fill-color": "#2e2e30" },
    boundary_state: { "line-color": "#3a3a3c" },
    "boundary_country_z0-4": { "line-color": "#636366" },
    "boundary_country_z5-": { "line-color": "#636366" },
  },
}

/** Light or dark, as the app is now (main.tsx toggles .dark on <html>). */
export const mapTheme = (): MapTheme => (document.documentElement.classList.contains("dark") ? "dark" : "light")

/** Recolour a loaded style for the app (call on "style.load"). */
export function restyleMap(map: MLMap, t: MapTheme) {
  for (const [id, paint] of Object.entries(PAINT[t])) {
    if (!map.getLayer(id)) continue
    for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k as "fill-color", v)
  }
  // A colour scheme can recolour the base map: --map-land, --map-water, --map-park (see themes/*.css).
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const land = v("--map-land"), water = v("--map-water"), park = v("--map-park")
  const set = (ids: string[], prop: string, c: string) => { if (c) for (const id of ids) if (map.getLayer(id)) map.setPaintProperty(id, prop as "fill-color", c) }
  set(["background"], "background-color", land)
  set(["landuse_residential", "landcover_ice_shelf", "landcover_glacier", "building"], "fill-color", land)
  set(["water"], "fill-color", water)
  set(["waterway"], "line-color", water)
  set(["park", "landuse_park", "landcover_wood"], "fill-color", park)
  for (const l of map.getStyle().layers) {
    if (l.type !== "symbol") continue
    // Sentence case (the stock styles set state and country names in capitals); no road shields.
    // Keep the base map quiet so the pins read first: no roads, small places, airports or POIs.
    if (/shield|oneway|highway|road|path|village|town|other|suburb|airport|poi/.test(l.id)) { map.setLayoutProperty(l.id, "visibility", "none"); continue }
    if (l.layout?.["icon-image"]) map.setLayoutProperty(l.id, "icon-image", "") // city dots
    if (l.layout?.["text-field"]) {
      map.setLayoutProperty(l.id, "text-transform", "none")
      // English names on one line (the stock labels add a second, non-Latin line that renders as dashes here).
      if (JSON.stringify(l.layout["text-field"]).includes("name")) map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]])
    }
    if (/label|place|name/.test(l.id)) {
      const faint = /state/.test(l.id) // state names sit behind city names
      map.setPaintProperty(l.id, "text-color", t === "dark" ? (faint ? "#636366" : "#98989d") : (faint ? "#aeaeb2" : "#6e6e73"))
      map.setPaintProperty(l.id, "text-halo-color", land || (t === "dark" ? "rgba(36,36,38,0.85)" : "rgba(246,244,239,0.9)"))
    }
  }
}

/** Follow light/dark and the colour scheme (data-scheme): reload the style so no old scheme colours linger. Returns a
 *  function that stops following. `onTheme` hears the new theme (to restyle on its "style.load"). */
export function followMapTheme(map: MLMap, onTheme: (t: MapTheme) => void): () => void {
  let t = mapTheme(), scheme = document.documentElement.dataset.scheme
  const mo = new MutationObserver(() => {
    const s = document.documentElement.dataset.scheme
    if (mapTheme() === t && s === scheme) return
    t = mapTheme(); scheme = s
    onTheme(t)
    map.setStyle(MAP_STYLE[t])
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme"] })
  return () => mo.disconnect()
}
