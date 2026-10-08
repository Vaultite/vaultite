// What the demo's server can't do in a browser (processes, sockets, the network as a server sees it, native modules):
// every node: module and package vite.demo.config.ts points here. Each call says the app does it.
export const NEEDS_APP = "This needs the Vaultite app: the demo runs in your browser"
export function needsApp(): never { throw new Error(NEEDS_APP) }

/** Callback-style calls (execFile) answer with the error rather than throw. */
export function execFile(...a: unknown[]) {
  const cb = a.findLast((x) => typeof x === "function") as ((e: Error) => void) | undefined
  if (!cb) needsApp()
  setTimeout(() => cb(new Error(NEEDS_APP)), 0)
  return { on() { return this }, once() { return this }, kill() {}, stdin: null, stdout: null, stderr: null }
}
export const exec = execFile
export const isBuiltin = () => false
export const registerHooks = () => ({ deregister() {} })
export const createRequire = () => needsApp
export const monitorEventLoopDelay = () => ({ enable() {}, disable() {}, reset() {}, mean: 0, max: 0, percentile: () => 0 })
export const STATUS_CODES: Record<number, string> = {}
export const isIP = () => 0
export class Readable { static from = needsApp }
export class Writable {}
export class WebSocketServer { constructor() { needsApp() } }
export class WebSocket { static OPEN = 1; constructor() { needsApp() } }
export const constants = {}
export const {
  execFileSync, execSync, spawn, spawnSync, fork, pipeline, request, get, createServer, connect, createConnection, lookup,
  createInterface, compile, Scanner, rolldown, DatabaseSync, Terminal, SerializeAddon, inflateRawSync, inflateSync, deflateRawSync,
  createInflateRaw, createInflate, createGunzip, createBrotliDecompress, zstdDecompressSync, crc32, gunzipSync, gzipSync, brotliCompressSync,
} = new Proxy({}, { get: () => needsApp }) as Record<string, typeof needsApp>
export default new Proxy({ execFile, exec, isBuiltin, registerHooks, createRequire, monitorEventLoopDelay, STATUS_CODES, isIP, Readable, Writable, WebSocketServer, WebSocket, constants },
  { get: (t, k) => (k in t ? t[k as keyof typeof t] : needsApp) })
