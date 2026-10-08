// The metro areas people are grouped into; anyone outside them is grouped by their location text. Shared by app and
// server, so it imports nothing.
const REGIONS: { name: string; lat: number; lon: number; km: number }[] = [
  { name: "Bay Area", lat: 37.7, lon: -122.2, km: 90 },
  { name: "Los Angeles area", lat: 34.05, lon: -118.25, km: 80 },
  { name: "Denver area", lat: 39.74, lon: -104.99, km: 50 },
  { name: "Seattle area", lat: 47.6, lon: -122.3, km: 50 },
  { name: "Chicago area", lat: 41.9, lon: -87.7, km: 60 },
  { name: "Washington DC area", lat: 38.9, lon: -77.05, km: 40 },
  { name: "Baltimore", lat: 39.29, lon: -76.61, km: 30 },
  { name: "New York area", lat: 40.75, lon: -73.95, km: 60 },
  { name: "Boston area", lat: 42.36, lon: -71.08, km: 50 },
  { name: "Toronto area", lat: 43.65, lon: -79.38, km: 50 },
  { name: "São Paulo", lat: -23.55, lon: -46.63, km: 70 },
  { name: "London", lat: 51.51, lon: -0.13, km: 50 },
  { name: "Paris", lat: 48.86, lon: 2.35, km: 40 },
  { name: "Tokyo", lat: 35.68, lon: 139.69, km: 60 },
]
export function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
export function regionOf(lat: number, lon: number, location: string) {
  return REGIONS.find((g) => km(lat, lon, g.lat, g.lon) <= g.km)?.name ?? (location.trim() || "Elsewhere")
}
