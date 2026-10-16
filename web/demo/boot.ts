// The web demo's start (npm run build:demo), main.tsx's first import: the server runs in a worker (worker.ts), reached
// through a service worker (sw.ts) for what the page fetches and a port for the live socket; then the app starts.
const server = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const ready = new Promise<void>((ok, no) => {
  server.onmessage = (e) => { if (e.data.type === "ready") ok(); else if (e.data.type === "failed") no(new Error(e.data.error)) }
})
navigator.serviceWorker.onmessage = (e) => { if (e.data?.type === "fetch") server.postMessage(e.data, [...e.ports]) }

/** The app's sockets (core/live.ts's /api/events, a plugin's: the inbox's), to the server over a port. What needs a
 *  machine (a terminal's) is off here, so the server refuses those. */
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
    const u = new URL(this.url), at = u.pathname.indexOf("/api/")
    if (at < 0) {
      setTimeout(() => { this.fire(new Event("error")); this.end(1006) }, 0)
      return
    }
    const ch = new MessageChannel()
    this.port = ch.port1
    this.port.onmessage = (e) => { if (e.data === null) this.end(1000); else this.fire(new MessageEvent("message", { data: e.data })) }
    server.postMessage({ type: "socket", url: u.pathname.slice(at) + u.search }, [ch.port2])
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

/** What says it's a demo: edits stay here, Reset, and where the app is. On phones, above their bottom bar, on two lines
 *  when narrow. */
function badge() {
  const style = document.createElement("style")
  style.textContent = `
    #vau-demo { position: fixed; z-index: 40; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex;
      gap: 10px; align-items: center; padding: 4px 6px 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--card);
      color: var(--muted-foreground); font: 12px/1.5 var(--font-sans, system-ui); box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); white-space: nowrap }
    #vau-demo button { font: inherit; color: var(--foreground); padding: 2px 10px; border-radius: 999px; background: var(--muted); cursor: pointer }
    @media (max-width: 767px) { #vau-demo { bottom: calc(max(env(safe-area-inset-bottom), 0.25rem) + 58px) } }
    @media (max-width: 479px) { #vau-demo { flex-wrap: wrap; justify-content: center; row-gap: 4px; width: max-content; max-width: calc(100vw - 24px);
      padding: 6px 8px; border-radius: 16px } #vau-demo > span { flex-basis: 100%; text-align: center } }`
  const bar = document.createElement("div")
  bar.id = "vau-demo"
  const button = (label: string, run: () => void) => {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = label
    b.onclick = run
    return b
  }
  const say = document.createElement("span")
  say.textContent = "Demo: your edits stay in this browser"
  bar.append(say, button("Reset", reset), button("Get the app", () => window.open("https://vaultite.com/download", "_blank", "noopener")))
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

/** The bundle picker of the page around the demo (vaultite.com): ?bundle=<id> opens on that bundle, ?bundle=gh:<owner>/<name>
 *  on one shared from GitHub (fetched by this browser: a bundle's link, vaultite.com/b/...), and a message from the page
 *  switches it, all only from the demo's own site. The page hears which one is on, and what it is (vaultite-demo:info). */
async function bundles() {
  const api = (path: string, body?: unknown) => fetch(`api/${path}`, body === undefined ? undefined
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
  const post = (m: unknown) => { if (parent !== window) parent.postMessage(m, location.origin) }
  let on: string | null = (await api("bundles")).previous?.bundle ?? null
  /** Turn a bundle on (applied without what runs code: the demo left it out); false when it couldn't. `running`: the app
   *  is, and follows it (its first page, Undo). */
  const use = async (asked: string, running = false) => {
    let id = asked
    if (asked.startsWith("gh:")) {
      const r = await api("bundles/import", { from: asked.slice(3) })
      if (r.error) return fail(asked, r.error)
      id = r.bundle.id
    }
    const p = await api(`bundles/${encodeURIComponent(id)}`)
    if (p.error) return fail(asked, p.error)
    const change = id !== on || !p.plan.empty
    if (change && running) {
      const { applyBundle } = await import("@/core/bundles")
      await applyBundle(p.bundle, p.plan)
    } else if (change) {
      const r = await api(`bundles/${encodeURIComponent(id)}/apply`, { workspace: null, allowCode: false })
      if (r.error) return fail(asked, r.error)
      // (the app opens on its first page, not the tab another bundle left)
      const first = r.plan?.pins?.list?.[0] ?? p.plan.pins?.list?.[0]
      if (first && !location.hash) history.replaceState(null, "", `#file/${encodeURIComponent(first)}`)
    }
    on = id
    const info = await api(`demo/bundle/${encodeURIComponent(id)}`)
    if (!info.error) { post({ type: "vaultite-demo:info", asked, bundle: info }); if (change) leftOut(info) }
    return true
  }
  const fail = (asked: string, error: string) => {
    post({ type: "vaultite-demo:info", asked, error })
    void toast(`Couldn't open ${asked.replace(/^gh:/, "")}: ${error}`, true)
    return false
  }
  const asked = new URLSearchParams(location.search).get("bundle")
  if (asked && asked !== on) await use(asked).catch((e) => fail(asked, String(e?.message ?? e)))
  post({ type: "vaultite-demo:bundle", bundle: on })
  addEventListener("message", async (e) => {
    if (e.origin !== location.origin || e.data?.type !== "vaultite-demo:apply" || typeof e.data.bundle !== "string") return
    try { await use(e.data.bundle, true) } catch (err) { fail(e.data.bundle, String((err as Error)?.message ?? err)) } finally { post({ type: "vaultite-demo:bundle", bundle: on }) }
  })
}

/** What the demo leaves out of a bundle, said plainly rather than looking broken: plugins needing a machine (terminals,
 *  agents) and those it installs from elsewhere (they run code: the app asks first). */
function leftOut(info: { needsApp: string[]; notInDemo: string[] }) {
  const few = (names: string[]) => (names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "))
  const parts = [info.needsApp.length && `${few(info.needsApp)} need${info.needsApp.length === 1 ? "s" : ""} the Vaultite app`,
    info.notInDemo.length && `${few(info.notInDemo)} run${info.notInDemo.length === 1 ? "s" : ""} code from elsewhere`].filter(Boolean)
  if (parts.length) void toast(`Off in the demo: ${parts.join("; ")}. The rest is here to try`)
}

/** A toast, once the app is there to show it (it starts after the demo's server). */
async function toast(text: string, error = false) {
  for (let i = 0; i < 100 && !document.querySelector("[data-pane], [data-sonner-toaster], section[aria-label^='Notifications']"); i++) await new Promise((ok) => setTimeout(ok, 100))
  const { notify } = await import("@/core/notify")
  notify(text, { kind: error ? "error" : undefined, duration: 10_000,
    action: error ? undefined : { label: "Get the app", run: () => { window.open("https://vaultite.com/download", "_blank", "noopener") } } })
}

await navigator.serviceWorker.register("sw.js", { scope: "./" })
if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }))
await ready
await bundles().catch(() => {}) // (the demo opens either way)
badge()
