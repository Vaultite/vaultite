// The web demo's start (npm run build:demo), main.tsx's first import: the server runs in a worker (worker.ts), reached
// through a service worker (sw.ts) for what the page fetches and a port for the live socket; then the app starts.
const server = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const ready = new Promise<void>((ok, no) => {
  server.onmessage = (e) => { if (e.data.type === "ready") ok(); else if (e.data.type === "failed") no(new Error(e.data.error)) }
})
navigator.serviceWorker.onmessage = (e) => { if (e.data?.type === "fetch") server.postMessage(e.data, [...e.ports]) }

/** core/live.ts's socket (/api/events), to the server over a port. Other sockets (a terminal's) need the app. */
class DemoSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0
  url: string
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  private port: MessagePort | null = null

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    if (!new URL(this.url).pathname.endsWith("/api/events")) {
      setTimeout(() => { this.fire(new Event("error")); this.end(1006) }, 0)
      return
    }
    const ch = new MessageChannel()
    this.port = ch.port1
    this.port.onmessage = (e) => { if (e.data === null) this.end(1000); else this.fire(new MessageEvent("message", { data: e.data })) }
    server.postMessage({ type: "socket" }, [ch.port2])
    queueMicrotask(() => { this.readyState = 1; this.fire(new Event("open")) })
  }
  send(text: string) { this.port?.postMessage(text) }
  close() { if (this.readyState < 2) { this.port?.postMessage(null); this.end(1000) } }
  private end(code: number) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.port?.close()
    this.fire(new CloseEvent("close", { code }))
  }
  private fire(e: Event) {
    this.dispatchEvent(e)
    ;(this[`on${e.type}` as "onopen"] as ((e: Event) => void) | null)?.(e)
  }
}
globalThis.WebSocket = DemoSocket as unknown as typeof WebSocket

/** What says it's a demo: edits stay here, Reset, and where the app is. On phones, above their bottom bar. */
function badge() {
  const style = document.createElement("style")
  style.textContent = `
    #vau-demo { position: fixed; z-index: 40; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex;
      gap: 10px; align-items: center; padding: 4px 6px 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--card);
      color: var(--muted-foreground); font: 12px/1.5 var(--font-sans, system-ui); box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); white-space: nowrap }
    #vau-demo button { font: inherit; color: var(--foreground); padding: 2px 10px; border-radius: 999px; background: var(--muted); cursor: pointer }
    @media (max-width: 767px) { #vau-demo { bottom: calc(max(env(safe-area-inset-bottom), 0.25rem) + 58px) } }`
  const bar = document.createElement("div")
  bar.id = "vau-demo"
  const button = (label: string, run: () => void) => {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = label
    b.onclick = run
    return b
  }
  bar.append("Demo: your edits stay in this browser", button("Reset", reset), button("Get the app", () => window.open("https://vaultite.com/download", "_blank", "noopener")))
  document.head.append(style)
  document.body.append(bar)
}

async function reset() {
  const { confirmDialog } = await import("@/components/ConfirmDialog")
  if (!(await confirmDialog({ title: "Reset the demo?", body: "Your edits are deleted and the sample vault comes back.", confirm: "Reset", danger: true }))) return
  const ch = new MessageChannel()
  await new Promise((ok) => { ch.port1.onmessage = ok; server.postMessage({ type: "reset" }, [ch.port2]) })
  for (const k of Object.keys(localStorage)) if (k.startsWith("vaultite.")) localStorage.removeItem(k)
  location.replace(location.pathname)
}

await navigator.serviceWorker.register("sw.js", { scope: "./" })
if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }))
await ready
badge()
