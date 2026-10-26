// The web demo's start (npm run build:demo), main.tsx's first import: the server runs in a worker (worker.ts), reached
// through a service worker (sw.ts) for what the page fetches and a port for the live socket; then the app starts.
import { SHOWN } from "./machine.ts"
import { NEEDS_APP } from "./node/stub.ts"

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

/** What needs a machine but is drawn here (machine.ts SHOWN): reads are answered in the page with its preview's made-up
 *  data (`mockLive`); writes need the app. */
const shownRoute = new RegExp(`^api/(${SHOWN.join("|")})(?=[/?]|$)`)
let made: Promise<Record<string, unknown>> | null = null
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const at = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const url = new URL(at, location.href), rel = url.pathname.slice(new URL(".", location.href).pathname.length) + url.search
  if (url.origin !== location.origin || !shownRoute.test(rel)) return realFetch(input, init)
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  if ((init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "GET") return answer({ error: NEEDS_APP }, 501)
  made ??= import("@/core/plugins").then(({ PLUGINS }) => Object.assign({}, ...PLUGINS.filter((p) => SHOWN.includes(p.id)).map((p) => p.mockLive?.() ?? {})))
  const mock = await made, path = rel.slice(4)
  // (as a preview finds them: the route, or the route with a query)
  const key = Object.keys(mock).find((k) => path === k || path.startsWith(`${k}?`))
  return key ? answer(mock[key]) : answer({ error: NEEDS_APP }, 501)
}

/** What says it's a demo: edits stay here, Reset, and where the app is. Dragged out of the way, it stays there for the
 *  tab's session. */
function badge() {
  const style = document.createElement("style")
  style.textContent = `
    #vau-demo { position: fixed; z-index: 40; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex;
      gap: 10px; align-items: center; padding: 4px 6px 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--card);
      color: var(--muted-foreground); font: 12px/1.5 var(--font-sans, system-ui); box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); white-space: nowrap;
      cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none }
    #vau-demo.moved { left: var(--x); top: var(--y); bottom: auto; transform: none }
    #vau-demo.dragging { cursor: grabbing; box-shadow: 0 6px 18px rgb(0 0 0 / 0.18) }
    #vau-demo .grip { display: inline-block; width: 6px; height: 10px; margin-right: 8px; vertical-align: -1px; opacity: 0.45;
      background: radial-gradient(circle, currentColor 1px, transparent 1.3px) 0 0 / 3px 3.4px }
    #vau-demo button { font: inherit; color: var(--foreground); padding: 2px 10px; border-radius: 999px; background: var(--muted); cursor: pointer }
    @media (max-width: 767px) { #vau-demo:not(.moved) { bottom: calc(max(env(safe-area-inset-bottom), 0.25rem) + 58px) } }
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
  const grip = document.createElement("i")
  grip.className = "grip"
  grip.setAttribute("aria-hidden", "true")
  say.append(grip, "Demo: your edits stay in this browser")
  bar.title = "Drag to move"
  bar.append(say, button("Reset", reset), button("Get the app", () => window.open("https://vaultite.com/download", "_blank", "noopener")))
  document.head.append(style)
  document.body.append(bar)
  draggable(bar)
}

/** Drag `bar` by any part but its buttons (mouse, pen or touch): a move of a few pixels is still a click; it stays in the
 *  window as it's dragged and as the window resizes, and comes back where it was for this tab (sessionStorage). */
function draggable(bar: HTMLElement) {
  const KEY = "vaultite.demo.badge", EDGE = 4, SLOP = 5
  const place = (x: number, y: number) => {
    const r = bar.getBoundingClientRect()
    x = Math.round(Math.min(Math.max(EDGE, x), Math.max(EDGE, innerWidth - r.width - EDGE)))
    y = Math.round(Math.min(Math.max(EDGE, y), Math.max(EDGE, innerHeight - r.height - EDGE)))
    bar.style.setProperty("--x", `${x}px`)
    bar.style.setProperty("--y", `${y}px`)
    bar.classList.add("moved")
    return { x, y }
  }
  try {
    const was = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { x?: unknown; y?: unknown } | null
    if (typeof was?.x === "number" && typeof was.y === "number") place(was.x, was.y)
  } catch { /* storage off: where it starts */ }
  let start: { id: number; px: number; py: number; x: number; y: number } | null = null, dragging = false
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return
    const r = bar.getBoundingClientRect()
    start = { id: e.pointerId, px: e.clientX, py: e.clientY, x: r.left, y: r.top }
    dragging = false
  })
  // (on the window: a quick move leaves the bar before it counts as a drag and takes the pointer)
  addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return
    const dx = e.clientX - start.px, dy = e.clientY - start.py
    if (!dragging) {
      if (Math.hypot(dx, dy) < SLOP) return
      dragging = true
      try { bar.setPointerCapture(e.pointerId) } catch { /* the window still hears it */ }
      bar.classList.add("dragging")
    }
    e.preventDefault()
    place(start.x + dx, start.y + dy)
  })
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return
    if (dragging) {
      const r = bar.getBoundingClientRect()
      try { sessionStorage.setItem(KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })) } catch { /* not kept */ }
    }
    start = null
    dragging = false
    bar.classList.remove("dragging")
  }
  addEventListener("pointerup", end)
  addEventListener("pointercancel", end)
  addEventListener("resize", () => { if (bar.classList.contains("moved")) { const r = bar.getBoundingClientRect(); place(r.left, r.top) } })
}

async function reset() {
  const { confirmDialog } = await import("@/components/ConfirmDialog")
  if (!(await confirmDialog({ title: "Reset the demo?", body: "Your edits are deleted and the sample vault comes back.", confirm: "Reset", danger: true }))) return
  const ch = new MessageChannel()
  await new Promise((ok) => { ch.port1.onmessage = ok; server.postMessage({ type: "reset" }, [ch.port2]) })
  for (const k of Object.keys(localStorage)) if (k.startsWith("vaultite.")) localStorage.removeItem(k)
  location.replace(location.pathname)
}

/** The bundle picker of the page around the demo (vaultite.com): ?bundle=<id>, or gh:<owner>/<name> for one shared from
 *  GitHub; a message switches it, only from the demo's own site, which hears what's on (vaultite-demo:info). */
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
function leftOut(info: { needsApp: string[]; notInDemo: string[]; madeUp?: string[] }) {
  const few = (names: string[]) => (names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "))
  const parts = [info.needsApp.length && `${few(info.needsApp)} need${info.needsApp.length === 1 ? "s" : ""} the Vaultite app`,
    info.notInDemo.length && `${few(info.notInDemo)} run${info.notInDemo.length === 1 ? "s" : ""} code from elsewhere`].filter(Boolean)
  // (a bundle about agents is mostly here, drawn with made-up data: a quiet note, not a list of what's missing)
  if (info.madeUp?.length) void toast(`Agents' sessions and activity are made up here.${parts.length ? ` ${parts.join("; ")}.` : ""}`, false, true)
  else if (parts.length) void toast(`Off in the demo: ${parts.join("; ")}. The rest is here to try`)
}

/** A toast, once the app is there to show it (it starts after the demo's server). `quiet`: shorter, no button. */
async function toast(text: string, error = false, quiet = false) {
  for (let i = 0; i < 100 && !document.querySelector("[data-pane], [data-sonner-toaster], section[aria-label^='Notifications']"); i++) await new Promise((ok) => setTimeout(ok, 100))
  const { notify } = await import("@/core/notify")
  notify(text, { kind: error ? "error" : undefined, duration: quiet ? 5_000 : 10_000,
    action: error || quiet ? undefined : { label: "Get the app", run: () => { window.open("https://vaultite.com/download", "_blank", "noopener") } } })
}

await navigator.serviceWorker.register("sw.js", { scope: "./" })
if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }))
await ready
await bundles().catch(() => {}) // (the demo opens either way)
badge()
