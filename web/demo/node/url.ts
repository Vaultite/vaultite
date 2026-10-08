// node:url for the demo's server: its modules are file:///app/... (vite.demo.config.ts) and its files in memory.
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname)
export const pathToFileURL = (p: string) => new URL(`file://${encodeURI(p).replace(/[?#]/g, encodeURIComponent)}`)
export const { URL, URLSearchParams } = globalThis
export default { fileURLToPath, pathToFileURL, URL, URLSearchParams }
