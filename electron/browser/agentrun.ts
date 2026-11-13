// What agents use now and then, loaded at their first use (index.ts `later`, agent.ts's import): run's sandbox for
// scripts, download, and the page scripts that draw the agent's pointer and find text by where it's drawn.
import { session, WebContentsView, type Session } from "electron"
import { localUrl, type EnginePage } from "./engine.ts"
import { scrub } from "./pagesecrets.ts"
import { actIn, acting, GLIDE_MS, hostOf, navigateIn, OUTSIDE, pageFor, readIn, record, refFor, serve, snapshot, waitIn } from "./agent.ts"
import { ACT, BY, WAIT, type By } from "./agentwire.ts"
import { z } from "zod"
import { messageOf } from "./errors.ts"
import path from "node:path"

// (in a world of its own and a closed shadow root: the page's scripts and styles never reach it)
export const POINTER = `(x, y, from, name, clicked) => {
  let a = window.__vaultiteAgent
  if (!a || !a.host.isConnected) {
    const host = document.createElement("vaultite-agent")
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important"
    host.setAttribute("aria-hidden", "true") // (never in the tree agents read: its name would be a change after each act)
    const root = host.attachShadow({ mode: "closed" })
    root.innerHTML = \`<style>
      .frame { position: fixed; inset: 0; box-shadow: inset 0 0 0 2px rgba(175,82,222,.5), inset 0 0 28px rgba(175,82,222,.22); opacity: 0; transition: opacity .4s }
      .at { position: fixed; left: 0; top: 0; transition: transform ${GLIDE_MS}ms cubic-bezier(.3,.7,.2,1), opacity .4s; opacity: 0 }
      svg { display: block; width: 22px; height: 22px; margin: -3px 0 0 -3px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)) }
      .name { position: absolute; left: 16px; top: 19px; padding: 2px 6px; border-radius: 6px; background: rgb(175,82,222); color: #fff;
        font: 500 11px/15px -apple-system, system-ui, sans-serif; white-space: nowrap; transition: opacity .4s }
      .ring { position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgb(175,82,222); opacity: 0 }
      .ring.go { animation: ring .5s ease-out }
      @keyframes ring { from { transform: scale(.4); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
      :host([data-on]) .frame, :host([data-on]) .at { opacity: 1 }
      :host([data-quiet]) .name { opacity: 0 }
    </style><div class="frame"></div><div class="at"><div class="ring"></div><svg viewBox="0 0 24 24"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z" fill="rgb(175,82,222)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="name"></span></div>\`
    document.documentElement.append(host)
    a = window.__vaultiteAgent = { host, at: root.querySelector(".at"), ring: root.querySelector(".ring"), name: root.querySelector(".name"), off: 0, quiet: 0 }
    a.at.style.transform = \`translate(\${from.x}px, \${from.y}px)\`
    a.at.getBoundingClientRect()
  }
  a.name.textContent = name
  a.host.setAttribute("data-on", "")
  a.host.removeAttribute("data-quiet")
  if (x !== null) a.at.style.transform = \`translate(\${x}px, \${y}px)\`
  if (clicked) setTimeout(() => { a.ring.classList.remove("go"); a.ring.getBoundingClientRect(); a.ring.classList.add("go") }, ${GLIDE_MS})
  clearTimeout(a.off); clearTimeout(a.quiet)
  a.quiet = setTimeout(() => a.host.setAttribute("data-quiet", ""), 2500)
  a.off = setTimeout(() => a.host.removeAttribute("data-on"), 6000)
}`

/** Where text the page shows is drawn (its first showing, an exact match first), scrolled into view: what a person would
 *  click to put the caret there, or double-click to select a word. */
export const TEXT_AT = (want: string) => `(() => {
  const want = ${JSON.stringify(want)}.toLowerCase(), found = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = walk.nextNode()) && found.length < 50;) { const t = n.data.toLowerCase(), i = t.indexOf(want); if (i >= 0 && n.parentElement && n.parentElement.getClientRects().length) found.push([n, i, t.trim() === want, !!n.parentElement.closest("[contenteditable=''], [contenteditable=true], textarea")]) }
  // (whole words before part of one, and text in an editor before the same text around it: a doc's title in its bar)
  const hit = found.find((f) => f[2] && f[3]) || found.find((f) => f[2]) || found.find((f) => f[3]) || found[0]
  if (!hit) return null
  const [node, i] = hit, range = document.createRange()
  range.setStart(node, i); range.setEnd(node, i + want.length)
  node.parentElement.scrollIntoView({ block: "center", inline: "nearest" })
  const b = range.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
})()`

// ---------- run: an agent's script composing the calls, in a sandbox of its own ----------

/** The script's page: Chromium's sandbox, a session with no network, no permissions and nothing kept. */
let sandbox: Session | null = null
function sandboxSession() {
  if (sandbox) return sandbox
  const s = session.fromPartition("vaultite-agent-run")
  s.webRequest.onBeforeRequest((_d, done) => done({ cancel: true }))
  s.setPermissionRequestHandler((_wc, _what, done) => done(false))
  s.setPermissionCheckHandler(() => false)
  return (sandbox = s)
}
const RUN_MS = 30_000
const CALL = "vaultite-run:"
/** In the script's page: the calls it has (each a message to this side), what it logs, and the script run as an async
 *  function's body. */
const BRIDGE = `(() => {
  const waits = new Map(), logs = []
  let n = 0
  window.__answer = (id, ok, v) => { const w = waits.get(id); if (!w) return; waits.delete(id); if (ok) w.ok(v); else w.fail(new Error(v)) }
  const call = (name, ...args) => new Promise((ok, fail) => { const id = ++n; waits.set(id, { ok, fail }); console.debug(${JSON.stringify(CALL)} + JSON.stringify({ id, name, args })) })
  const log = (...a) => { if (logs.length < 500) logs.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 2000)) }
  window.__run = async (script, args) => {
    const api = {
      args,
      snapshot: () => call("snapshot"),
      act: (action, ref, value) => call("act", action && typeof action === "object" ? action : { action, ref, value }),
      fill: (fields) => call("act", { action: "fill", fields: Array.isArray(fields) ? fields : Object.entries(fields ?? {}).map(([ref, value]) => ({ ref, value: String(value) })) }),
      ref: (name, role) => call("ref", name, role),
      read: () => call("read"),
      wait: (what) => call("wait", what ?? {}),
      go: (to) => call("go", to),
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(30000, Number(ms) || 0))),
      log,
    }
    try {
      const fn = new (async function () {}).constructor(...Object.keys(api), "console", script)
      const value = await fn(...Object.values(api), { log, info: log, warn: log, error: log, debug: log })
      return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)), logs }
    } catch (e) { return { error: String(e && e.message || e), logs } }
  }
})()`

/** The first control whose name has `name` (an exact one first), of `role` if given: its ref, or null. */
const refIn = (p: EnginePage, name: unknown, role: unknown) => refFor(p, String(name ?? ""), String(role ?? "") || undefined).catch(() => null)

const TIMEOUT = z.object({ timeout: z.unknown().optional() }).catch({})
const RAN = z.object({ value: z.unknown().optional(), error: z.string().optional(), logs: z.array(z.string()).catch([]) }).catch({ error: "its answer couldn't be read", logs: [] })
async function runIn(p: EnginePage, script: string, who: By, args?: unknown) {
  if (!script.trim()) throw new Error("run needs a script")
  const view = new WebContentsView({ webPreferences: { session: sandboxSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const wc = view.webContents
  wc.setWindowOpenHandler(() => ({ action: "deny" }))
  wc.on("will-navigate", (e) => e.preventDefault())
  // (each call checks the tab's access again: the user may pause agents mid-run)
  const calls: Record<string, (...a: unknown[]) => Promise<unknown>> = {
    snapshot: async () => (await snapshot(pageFor(p.id, "read", who))).snapshot,
    act: (a) => actIn(pageFor(p.id, "act", who), ACT.parse(a && typeof a === "object" ? { diff: "none", ...a } : { action: "" }), who),
    ref: (name, role) => refIn(pageFor(p.id, "read", who), name, role),
    read: async () => (await readIn(pageFor(p.id, "read", who))).text,
    wait: (w) => waitIn(pageFor(p.id, "read", who), WAIT.parse(w), (Number(TIMEOUT.parse(w).timeout) || 10) * 1000),
    go: (to) => navigateIn(pageFor(p.id, "act", who), to, who),
  }
  const answer = (id: unknown, ok: boolean, v: unknown) => {
    if (!wc.isDestroyed()) void wc.executeJavaScript(`window.__answer(${JSON.stringify(id)}, ${ok}, ${JSON.stringify(v ?? null)})`).catch(() => {})
  }
  wc.on("console-message", (e) => {
    if (!e.message.startsWith(CALL)) return
    let m: { id?: unknown; name?: unknown; args?: unknown[] }
    try { m = JSON.parse(e.message.slice(CALL.length)) } catch { return }
    const fn = calls[String(m.name)]
    void (fn ? fn(...(Array.isArray(m.args) ? m.args : [])) : Promise.reject(new Error(`no call ${String(m.name)}`)))
      .then((v) => answer(m.id, true, v), (err) => answer(m.id, false, messageOf(err)))
  })
  acting(p, who, "Running a script")
  void record(p, who, { action: "run", value: script.slice(0, 2000) })
  let late = false, timer: NodeJS.Timeout | undefined
  try {
    await wc.loadURL("about:blank")
    await wc.executeJavaScript(BRIDGE)
    const out = RAN.parse(await Promise.race([
      wc.executeJavaScript(`window.__run(${JSON.stringify(script)}, ${JSON.stringify(args ?? null)})`),
      new Promise<never>((_r, fail) => { timer = setTimeout(() => { late = true; fail(new Error(`the script took over ${RUN_MS / 1000} s: it was stopped`)) }, RUN_MS) }),
    ]))
    if (out.error) throw new Error(`the script failed: ${out.error}${out.logs.length ? `\nIt logged:\n${out.logs.join("\n")}` : ""}`)
    let value = JSON.stringify(out.value ?? null) ?? "null"
    if (value.length > 100_000) value = `${value.slice(0, 100_000)}… (cut short)`
    return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), value, logs: out.logs }
  } finally {
    clearTimeout(timer)
    if (late && !wc.isDestroyed()) wc.forcefullyCrashRenderer()
    if (!wc.isDestroyed()) wc.close()
  }
}

/** A file at `url` as the tab's page would get it (its logins, its address as referrer): for a link's PDF, an invoice. */
serve("agent:download", async (_win, tab, url, by) => {
  const who = BY.parse(by), p = pageFor(tab, "act", who), u = String(url ?? "")
  let to: URL
  try { to = new URL(u, p.wc.getURL()) } catch { throw new Error("an http(s) address") }
  if (!/^https?:$/.test(to.protocol)) throw new Error("an http(s) address")
  if (who.remote && localUrl(to.href)) throw new Error(OUTSIDE)
  acting(p, who, `Downloading from ${hostOf(to.href)}`)
  const r = await p.wc.session.fetch(to.href, { credentials: "include", referrer: p.wc.getURL() } as RequestInit)
  if (!r.ok) throw new Error(`${to.href} answered ${r.status} ${r.statusText}`)
  const data = Buffer.from(await r.arrayBuffer())
  if (data.length > 50 << 20) throw new Error("the file is over 50 MB")
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get("content-disposition") ?? "")?.[1]
  const name = decodeURIComponent(named ?? path.basename(to.pathname) ?? "") || "download"
  void record(p, who, { action: "download", value: to.href })
  return { tab: p.id, url: scrub(to.href), name, type: r.headers.get("content-type") ?? "", data: data.toString("base64") }
})
serve("agent:run", (_win, tab, script, by, args) => runIn(pageFor(tab, "act", BY.parse(by)), String(script ?? ""), BY.parse(by), args))
