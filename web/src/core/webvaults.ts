import { api } from "@/core/http"

export type KnownVault = { path: string; name: string; nickname?: string; open?: boolean
  sandbox?: boolean
  remote?: boolean }
export type VaultList = { current?: string | null; home?: string; vaults: KnownVault[] }
export type FolderList = { path: string; home: string; parent: string | null; folders: { name: string; vault: boolean }[] }
export type VaultBackend = {
  list: () => Promise<VaultList>
  open: (path: string) => Promise<unknown>
  create: (parent: string, name: string) => Promise<unknown>
  remove: (path: string) => Promise<unknown>
  nickname?: (path: string, typed: string) => Promise<void>
  watch?: (fn: () => void) => () => void
  pick?: () => Promise<string | null>
  folders?: (path?: string) => Promise<FolderList>
  reveal?: (path: string) => void
  connect?: (address: string) => Promise<unknown>
  playground?: () => Promise<unknown>
}

export const webVaults: VaultBackend = {
  list: () => api("GET", "vaults"),
  open: (path) => api("POST", "vaults/open", { path }).then(switched),
  create: (parent, name) => api("POST", "vaults/create", { parent, name }).then(switched),
  remove: (path) => api("DELETE", `vaults?path=${encodeURIComponent(path)}`),
  folders: (path) => api("GET", `vaults/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`),
}

function switched() {
  try { localStorage.removeItem("vaultite.tabs") } catch {}
  location.replace(location.pathname)
}
