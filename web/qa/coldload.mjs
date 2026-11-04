// A phone's first and later loads, through the tailnet's proxy: the vault's state asked for before the app's code, which
// comes in a few files, compressed and kept for good; a reload asks only for the page; a new build on the server is
// fetched before the reload into it. WRITES: nothing.
//   node web/qa/coldload.mjs <base url>
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "X-Forwarded-For": "100.64.0.2" } })
// (the live socket's hello names the server's build: one that says another stands for a deploy)
let otherBuild = false, socket = null
await ctx.routeWebSocket(/\/api\/events/, (ws) => {
  socket = ws
  const server = ws.connectToServer()
  server.onMessage((m) => {
    const hello = otherBuild && typeof m === "string" && m.includes('"type":"hello"')
    ws.send(hello ? m.replace(/"web":"[^"]*"/, '"web":"main-next.js"') : m)
  })
  ws.onMessage((m) => server.send(m))
})
const page = watch(await ctx.newPage())
const cdp = await ctx.newCDPSession(page)
await cdp.send("Network.enable")
let sent = []
const answers = new Map()
cdp.on("Network.requestWillBeSent", (e) => {
  if (e.request.url.startsWith(B)) sent.push({ id: e.requestId, path: new URL(e.request.url).pathname, type: e.type, cached: false, from: e.initiator.stack?.callFrames[0]?.url ?? e.initiator.url })
})
cdp.on("Network.requestServedFromCache", (e) => { const r = sent.find((x) => x.id === e.requestId); if (r) r.cached = true })
cdp.on("Network.responseReceived", (e) => {
  answers.set(e.requestId, e.response)
  const r = sent.find((x) => x.id === e.requestId); if (r && e.response.fromDiskCache) r.cached = true
})
const drawn = () => until(() => page.evaluate(() => document.querySelectorAll("[role=tab]").length > 0 || !!document.querySelector("h1")), 20_000)

// Cold.
await page.goto(B)
await drawn()
await wait(1500)
const assets = sent.filter((r) => r.path.startsWith("/assets/"))
const state = sent.filter((r) => r.path === "/api/state")
check("the state is asked for by the page, before the app's code runs", state[0]?.from === B, state[0]?.from)
check("and once", state.length === 1, state.length)
const eager = [...(await (await fetch(B)).text()).matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].length
check("the app's code comes in a few files", eager > 0 && eager <= 16, eager)
const header = (r, name) => Object.entries(answers.get(r.id)?.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? ""
const js = assets.filter((r) => r.path.endsWith(".js"))
const big = js.filter((r) => Number(header(r, "content-length") || 2048) >= 1024)
check("its files come compressed", big.length > 0 && big.every((r) => /br|gzip/.test(header(r, "content-encoding"))), big.map((r) => `${r.path} ${header(r, "content-encoding")}`))
check("and are kept for good", js.every((r) => /immutable/.test(header(r, "cache-control"))), js.map((r) => header(r, "cache-control")))

// Warm: only the page and the API reach the server.
sent = []
await page.reload()
await drawn()
await wait(1500)
const fetched = sent.filter((r) => r.path.startsWith("/assets/") && !r.cached)
check("a reload fetches none of the app's files", fetched.length === 0, fetched.map((r) => r.path))

// A deploy: the server names another build, and its files are fetched, quietly, before the reload into it.
otherBuild = true
sent = []
await socket.close({ code: 1001, reason: "restarting" }) // (the server restarting into it: the app connects again)
const got = await until(() => sent.filter((r) => r.type === "Fetch" && r.path.startsWith("/assets/")).length >= eager, 30_000)
check("a new build's files are fetched before the reload into it", got, sent.filter((r) => r.type === "Fetch").map((r) => r.path))
check("and it says so", await until(() => page.getByText("A new version of Vaultite is ready").count(), 5000))

await ctx.close()
await done()
