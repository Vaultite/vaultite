// The web demo's service worker: what the page asks of its server (api/, and a plugin's own addresses: plugin.serve)
// goes to the demo's server in the page (boot.ts, worker.ts); the rest is the demo's own files.
const sw = self as unknown as {
  registration: { scope: string }; clients: { claim(): Promise<void>; matchAll(o: object): Promise<{ id: string; url: string; postMessage(m: unknown, t: Transferable[]): void }[]> }
  skipWaiting(): Promise<void>; addEventListener(type: string, fn: (e: never) => void): void
}
type FetchEvent = { request: Request; clientId: string; respondWith(r: Promise<Response>): void; waitUntil(p: Promise<unknown>): void }
type Answer = { status: number; headers: Record<string, string>; body: string | ArrayBuffer | null }

sw.addEventListener("install", () => { void sw.skipWaiting() })
sw.addEventListener("activate", (e: FetchEvent) => e.waitUntil(sw.clients.claim()))
sw.addEventListener("fetch", (e: FetchEvent) => {
  const url = new URL(e.request.url), scope = new URL(sw.registration.scope).pathname
  if (url.origin !== location.origin || !url.pathname.startsWith(scope)) return
  const rel = url.pathname.slice(scope.length)
  // (a folder other than the build's assets may be a plugin's: asked of the server first)
  const api = rel.startsWith("api/")
  if (!api && (e.request.method !== "GET" || !rel.includes("/") || rel.startsWith("assets/"))) return
  e.respondWith(ask(e, rel + url.search, scope).then((r) => r ?? fetch(e.request)))
})

async function ask(e: FetchEvent, url: string, scope: string): Promise<Response | null> {
  // The app's own page (a frame shows what the server serves, never the app)
  const all = await sw.clients.matchAll({ type: "window" })
  const top = (c: { url: string }) => !new URL(c.url).pathname.slice(scope.length).includes("/")
  const page = all.find((c) => c.id === e.clientId && top(c)) ?? all.find(top)
  if (!page) return new Response(JSON.stringify({ error: "the demo isn't open" }), { status: 503, headers: { "Content-Type": "application/json" } })
  const headers: Record<string, string> = {}
  e.request.headers.forEach((v, k) => { headers[k] = v })
  const body = e.request.method === "GET" || e.request.method === "HEAD" ? null : await e.request.arrayBuffer()
  const ch = new MessageChannel()
  const answer = new Promise<Answer>((ok) => { ch.port1.onmessage = (m) => ok(m.data) })
  page.postMessage({ type: "fetch", ask: { method: e.request.method, url, headers, body } }, [ch.port2, ...(body ? [body] : [])])
  const a = await answer
  if (!url.startsWith("api/") && a.status === 404) return null
  return new Response([204, 205, 304].includes(a.status) || e.request.method === "HEAD" ? null : a.body, { status: a.status, headers: a.headers })
}
