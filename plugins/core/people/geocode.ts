// Free-text place -> [lat, lon] for the People map: the built-in table, then Nominatim, then the table with leading
// parts dropped. null when nothing matches or the network's down, so a lookup never breaks a write.
export type LatLon = [number, number]

// "Name[, qualifier]" -> [lat, lon]. Add a line here when a new vague or recurring place shows up.
const PLACES: Record<string, LatLon> = {
  // Bay Area
  "Bay Area": [37.6688, -122.0808], // centroid-ish, Hayward (on land, between SF, Oakland and San Jose)
  "East Bay": [37.7799, -122.1800],
  "South Bay": [37.3541, -121.9552], // Santa Clara
  "Peninsula, CA": [37.5200, -122.2800],
  "Berkeley, CA": [37.8715, -122.2730],
  "Oakland, CA": [37.8044, -122.2712],
  "San Francisco, CA": [37.7749, -122.4194],
  "SF": [37.7749, -122.4194],
  "San Jose, CA": [37.3382, -121.8863],
  "Palo Alto, CA": [37.4419, -122.1430],
  "Stanford, CA": [37.4275, -122.1697],
  "Mountain View, CA": [37.3861, -122.0839],
  "Sunnyvale, CA": [37.3688, -122.0363],
  "Santa Clara, CA": [37.3541, -121.9552],
  "Cupertino, CA": [37.3230, -122.0322],
  "Menlo Park, CA": [37.4530, -122.1817],
  // Elsewhere in the US
  "Los Angeles, CA": [34.0522, -118.2437],
  "Pasadena, CA": [34.1478, -118.1445],
  "San Diego, CA": [32.7157, -117.1611],
  "Seattle, WA": [47.6062, -122.3321],
  "Chicago, IL": [41.8781, -87.6298],
  "Evanston, IL": [42.0451, -87.6877],
  "Minneapolis, MN": [44.9778, -93.2650],
  "Ann Arbor, MI": [42.2808, -83.7430],
  "Pittsburgh, PA": [40.4406, -79.9959],
  "Philadelphia, PA": [39.9526, -75.1652],
  "New York, NY": [40.7128, -74.0060],
  "NYC": [40.7128, -74.0060],
  "New York": [40.7128, -74.0060], // the city, not the state
  "Brooklyn, NY": [40.6782, -73.9442],
  "Princeton, NJ": [40.3573, -74.6672],
  "New Haven, CT": [41.3083, -72.9279],
  "Boston, MA": [42.3601, -71.0589],
  "Cambridge, MA": [42.3736, -71.1097],
  "Washington, DC": [38.9072, -77.0369],
  "Arlington, VA": [38.8816, -77.0910],
  "Baltimore, MD": [39.2904, -76.6122],
  "Atlanta, GA": [33.7490, -84.3880],
  "Austin, TX": [30.2672, -97.7431],
  "Denver, CO": [39.7392, -104.9903],
  "Houston, TX": [29.7604, -95.3698],
  // Elsewhere
  "Toronto, Canada": [43.6532, -79.3832],
  "Vancouver, Canada": [49.2827, -123.1207],
  "Mexico City, Mexico": [19.4326, -99.1332],
  "São Paulo, Brazil": [-23.5505, -46.6333],
  "Sao Paulo, Brazil": [-23.5505, -46.6333],
  "Buenos Aires, Argentina": [-34.6037, -58.3816],
  "London, UK": [51.5072, -0.1276],
  "Paris, France": [48.8566, 2.3522],
  "Berlin, Germany": [52.52, 13.405],
  "Madrid, Spain": [40.4168, -3.7038],
  "Lisbon, Portugal": [38.7223, -9.1393],
  "Amsterdam, Netherlands": [52.3676, 4.9041],
  "Zurich, Switzerland": [47.3769, 8.5417],
  "Bangalore, India": [12.9716, 77.5946],
  "Singapore": [1.3521, 103.8198],
  "Tokyo, Japan": [35.6762, 139.6503],
  "Seoul, South Korea": [37.5665, 126.978],
  "Sydney, Australia": [-33.8688, 151.2093],
}

// US states: abbreviation, name, a centroid on land.
const STATES = `AL Alabama 32.81 -86.79|AK Alaska 61.37 -152.40|AZ Arizona 33.73 -111.43|AR Arkansas 34.97 -92.37
|CA California 36.78 -119.42|CO Colorado 39.06 -105.31|CT Connecticut 41.60 -72.76|DE Delaware 39.32 -75.51
|DC District_of_Columbia 38.91 -77.04|FL Florida 27.77 -81.69|GA Georgia 33.04 -83.64|HI Hawaii 21.09 -157.50
|ID Idaho 44.24 -114.48|IL Illinois 40.35 -88.99|IN Indiana 39.85 -86.26|IA Iowa 42.01 -93.21|KS Kansas 38.53 -96.73
|KY Kentucky 37.67 -84.67|LA Louisiana 31.17 -91.87|ME Maine 44.69 -69.38|MD Maryland 39.06 -76.80
|MA Massachusetts 42.23 -71.53|MI Michigan 43.33 -84.54|MN Minnesota 46.28 -94.31|MS Mississippi 32.74 -89.68
|MO Missouri 38.46 -92.29|MT Montana 46.92 -110.45|NE Nebraska 41.13 -98.27|NV Nevada 38.31 -117.06
|NH New_Hampshire 43.45 -71.56|NJ New_Jersey 40.30 -74.52|NM New_Mexico 34.84 -106.25|NY New_York 42.17 -74.95
|NC North_Carolina 35.63 -79.81|ND North_Dakota 47.53 -99.78|OH Ohio 40.39 -82.76|OK Oklahoma 35.57 -96.93
|OR Oregon 44.57 -122.07|PA Pennsylvania 40.59 -77.21|RI Rhode_Island 41.68 -71.51|SC South_Carolina 33.86 -80.95
|SD South_Dakota 44.30 -99.44|TN Tennessee 35.75 -86.69|TX Texas 31.05 -97.56|UT Utah 40.15 -111.86
|VT Vermont 44.05 -72.71|VA Virginia 37.77 -78.17|WA Washington 47.40 -121.49|WV West_Virginia 38.49 -80.95
|WI Wisconsin 44.27 -89.62|WY Wyoming 42.76 -107.30`

function norm(s: string) {
  s = (s ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  return s.replace(/,?\s*(usa|us|united states)$/, "").replace(/^[ ,]+|[ ,]+$/g, "")
}

const STATE_NAME = new Map<string, string>()
const INDEX = new Map<string, LatLon>()
const setDefault = (k: string, v: LatLon) => { if (!INDEX.has(k)) INDEX.set(k, v) }

for (const entry of STATES.replaceAll("\n", "").split("|")) {
  const [ab, raw, lat, lon] = entry.split(/\s+/)
  const name = raw.replaceAll("_", " ")
  STATE_NAME.set(ab.toLowerCase(), name.toLowerCase())
  setDefault(ab.toLowerCase(), [Number(lat), Number(lon)])
  setDefault(name.toLowerCase(), [Number(lat), Number(lon)])
}
for (const [place, ll] of Object.entries(PLACES)) {
  const n = norm(place)
  INDEX.set(n, ll)
  const parts = n.split(",").map((p) => p.trim())
  const last = parts[parts.length - 1]
  if (parts.length > 1 && STATE_NAME.has(last)) setDefault([...parts.slice(0, -1), STATE_NAME.get(last)!].join(", "), ll) // "berkeley, california"
  setDefault(parts[0], ll) // "berkeley" (first entry wins)
}

/** Built-in table only (no network). Exact, then with leading parts dropped. */
function lookup(location: string): LatLon | null {
  const parts = norm(location).split(",").map((p) => p.trim()).filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const ll = INDEX.get(parts.slice(i).join(", "))
    if (ll) return ll
  }
  return null
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4

async function nominatim(location: string, timeout = 5000): Promise<LatLon | null> {
  const q = new URLSearchParams({ q: location, format: "jsonv2", limit: "1" })
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": "vaultite/1.0 (personal app, a few requests a month)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(timeout),
  })
  if (!r.ok) throw new Error(`nominatim: ${r.status}`)
  const hits = await r.json()
  return hits.length ? [round4(Number(hits[0].lat)), round4(Number(hits[0].lon))] : null
}

/** [lat, lon] or null. Never throws. */
export async function geocode(location: string, network = true): Promise<LatLon | null> {
  if (!(location ?? "").trim()) return null
  const hit = INDEX.get(norm(location))
  if (hit) return hit
  if (network) {
    try {
      const ll = await nominatim(location)
      if (ll) return ll
    } catch {
      // offline or rate limited: the table below
    }
  }
  return lookup(location)
}
