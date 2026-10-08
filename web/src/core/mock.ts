// Made-up data for plugin previews: each plugin makes its own store keys (`mock`, `mockLive` for live data), so every
// page renders its real layout with fictional people, notes and logs.
import type { Store } from "@/core/data"
import { PLUGINS } from "@/core/plugins"

export function mockStore(real: Store): Store {
  const mock = {
    me: { id: "ME", location: "Denver, CO", lat: 39.74, lon: -104.99, body: "" },
    vault: { path: "", problems: [] },
    files: { files: [], others: [], folders: [] },
  } as Partial<Store>
  for (const p of PLUGINS) if (p.mock) Object.assign(mock, p.mock(real))
  return mock as Store
}
