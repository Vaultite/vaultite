// node:util for the demo's server.
export const promisify = (fn: (...a: unknown[]) => void) => (...a: unknown[]) =>
  new Promise((ok, no) => fn(...a, (e: unknown, v: unknown) => (e ? no(e) : ok(v))))
export const inspect = (v: unknown) => { try { return typeof v === "string" ? v : JSON.stringify(v) } catch { return String(v) } }
export const format = (...a: unknown[]) => a.map(inspect).join(" ")
export default { promisify, inspect, format, TextDecoder, TextEncoder }
