// The QUIET helper started on a home server of the test's (server.ts), and what drivers share: what threw, waits.
import { homeServer } from "./server.ts"

export const crashes: string[] = []
process.on("uncaughtException", (e) => crashes.push(e.message))
process.on("unhandledRejection", (e) => crashes.push(e instanceof Error ? e.message : String(e)))
export const out: { [name: string]: ReturnType<typeof JSON.parse> } = {}
setTimeout(() => { process.stderr.write(`still running after 80 s: ${Object.keys(out).at(-1)} was the last done\n`); process.exit(2) }, 80_000).unref()
export const J = JSON.stringify
export const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms))
export async function until(ok: () => boolean, ms = 2000) { for (const end = Date.now() + ms; !ok() && Date.now() < end;) await tick(10) }
export const caught = <T,>(p: Promise<T>) => p.then((v) => v, (e: Error) => ({ threw: e.message }))
export const threw = () => [...new Set(crashes.splice(0))]
export const ROOT = "../../../../electron"
const noop = () => {}

export async function quietHelper() {
  const H = await import(`${ROOT}/helper.ts`), home = await homeServer(), events: [string, unknown][] = []
  const dictation = new Proxy({}, { get: () => () => noop })
  await H.startHelper({ dictation, home: () => ({ port: home.port, path: "/v", name: "Lighthouse" }), openHome: noop, focusedPage: () => null, homeWindow: () => null,
    event: (name: string, data: { bundle?: string }) => events.push([name, data]), prefs: () => ({}), setPrefs: noop, quit: noop, icon: "" })
  await until(() => home.sockets() > 0)
  await until(() => home.said.length >= 1)
  return { H, home, events, close: () => { H.stopHelper(); home.close() } }
}
export function done() {
  process.stdout.write(J(out) + "\n")
  process.exit(0)
}
