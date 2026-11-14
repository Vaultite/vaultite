import type { ContextType } from "react"
import type { PreviewLive, Store } from "@/core/data"
import { PLUGINS } from "@/core/plugins"

export function mockStore(real: Store): Store {
  const mock: Partial<Store> = {
    me: { id: "ME", location: "Denver, CO", lat: 39.74, lon: -104.99, body: "" },
    vault: { path: "", problems: [] },
    files: { files: [], others: [], folders: [] },
  }
  for (const p of PLUGINS) if (p.mock) Object.assign(mock, p.mock(real))
  return mock as Store
}

export const mockLive = (): NonNullable<ContextType<typeof PreviewLive>> => Object.assign({}, ...PLUGINS.map((p) => p.mockLive?.() ?? {}))
