import { app, type Rectangle } from "electron"
import fs from "node:fs"
import path from "node:path"
import { DEV } from "./identity.ts"
import { UPDATE_MODES, type UpdateMode } from "./updates.ts"
import type { HelperPrefs } from "./helper.ts"
import { sandboxPath } from "./sandbox.ts"
import * as Setup from "./setup.ts"

export type Known = {
  path: string; port?: number; open?: boolean; last?: number
  bounds?: Rectangle; maximized?: boolean
  lightsOff?: boolean
  outside?: string[]
}
const LIST = () => path.join(app.getPath("userData"), "vaults.json")
export const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
export let known: Known[] = []
type Remote = { url: string; name: string; open?: boolean; last?: number; bounds?: Rectangle }
export let remotes: Remote[] = []
// One for every window: Chromium zooms by host, and every vault's server is on 127.0.0.1.
export let zoom = 1
// Off unless set: any process on this Mac that reaches Chromium's DevTools port controls the app.
let debugPort: number | undefined
export let updates: UpdateMode = "notify"
export let helperPrefs: HelperPrefs = {}
try {
  const v = JSON.parse(fs.readFileSync(LIST(), "utf8"))
  known = Array.isArray(v.vaults) ? v.vaults.filter((x: Known) => x && typeof x.path === "string") : []
  remotes = Array.isArray(v.servers) ? v.servers.filter((x: Remote) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url)) : []
  if (typeof v.zoom === "number" && v.zoom >= ZOOMS[0] && v.zoom <= ZOOMS[ZOOMS.length - 1]) zoom = v.zoom
  if (Number.isInteger(v.debugPort) && v.debugPort > 1024 && v.debugPort < 65536) debugPort = v.debugPort
  if (UPDATE_MODES.includes(v.updates)) updates = v.updates
  if (v.helper && typeof v.helper === "object") helperPrefs = v.helper
} catch {}
const envPort = Number(process.env.VAULTITE_DEBUG_PORT)
export const devtools = Number.isInteger(envPort) && envPort > 1024 && envPort < 65536 ? envPort : debugPort
let saveTimer: ReturnType<typeof setTimeout> | null = null
export function save(now = false) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const write = () => {
    Setup.writeAtomic(LIST(), JSON.stringify({ vaults: known, ...(remotes.length ? { servers: remotes } : {}), ...(zoom === 1 ? {} : { zoom }), ...(debugPort ? { debugPort } : {}),
      ...(updates === "notify" ? {} : { updates }), ...(Object.keys(helperPrefs).length ? { helper: helperPrefs } : {}) }, null, 2) + "\n")
  }
  if (now) write()
  else saveTimer = setTimeout(write, 500)
}
export const nameOf = (p: string) => (p === sandboxPath() ? "Playground" : path.basename(p) || p)
export const find = (p: string) => known.find((v) => v.path === p)
export function remember(p: string) {
  let v = find(p)
  if (!v) known.push((v = { path: p }))
  v.last = Date.now()
  save()
  buildMenu()
  return v
}
export const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
export function vaultOf(p: string): [Known, string] | null {
  const r = real(p)
  for (const v of known) {
    const root = real(v.path)
    if (r.startsWith(root + path.sep)) return [v, path.relative(root, r).split(path.sep).join("/")]
  }
  return null
}

// Its last port: localStorage is by origin.
export function portFor(v: Known, taken = false) {
  if (v.port && !taken) return v.port
  let p: number
  do p = (DEV ? 40000 : 20000) + Math.floor(Math.random() * 20000)
  while (known.some((k) => k.port === p))
  v.port = p
  save()
  return p
}
export class PortTaken extends Error {}
export const setKnown = (to: Known[]) => { known = to }
export const setRemotes = (to: Remote[]) => { remotes = to }
export const setZoom = (to: number) => { zoom = to }
export const setUpdates = (to: UpdateMode) => { updates = to }
export const setHelperPrefs = (to: HelperPrefs) => { helperPrefs = to }
let menuBuilder: (() => void) | null = null
export const setMenuBuilder = (build: () => void) => { menuBuilder = build }
export const buildMenu = () => menuBuilder?.()
