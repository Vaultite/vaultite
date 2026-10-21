// Agents in the browser, asked by the vault's server (plugins/core/web-viewer/plugin.ts): a page's accessibility tree with
// refs, then real input on them over the DevTools protocol (no page scripts); each container's access is checked here.
import { app, type WebContents } from "electron"
import fs from "node:fs"
import path from "node:path"
import { allPages, eachPage, handle, mayOpen, tell, type EnginePage } from "./engine.ts"

type Access = "none" | "read" | "act"
/** By profile; a profile not named is none. `home`: where an agent's new tab opens unless it names a container. */
let access = new Map<string, Access>()
let home = ""
/** Pages the user paused agents in (the bar's Stop), till they resume. */
const paused = new Set<number>()

const accessOf = (p: EnginePage): Access => (!mayOpen(p.profile) ? "none" : access.get(p.profile) ?? "none")
const levels: Record<Access, number> = { none: 0, read: 1, act: 2 }

/** The page `tab` if agents may `need` there, else why not. */
function pageFor(tab: unknown, need: "read" | "act"): EnginePage {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  const a = accessOf(p)
  if (levels[a] < levels[need]) {
    throw new Error(a === "none"
      ? "agents may not use this tab: its container doesn't let them (Agents, in the container menu of the page's bar)"
      : "agents may only read this tab: its container lets them read, not act")
  }
  if (need === "act" && paused.has(p.id)) throw new Error("the user paused agents in this tab")
  // (an extension's own page, Focus's blocked page and its ask for time among them, is the user's alone)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("agents use web pages only, not an extension's or the app's")
  return p
}

// ---------- the DevTools protocol, one session per page ----------

const attached = new WeakSet<WebContents>()
async function cdp<T = Record<string, unknown>>(wc: WebContents, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!attached.has(wc)) {
    try { wc.debugger.attach("1.3") } catch (e) {
      if (!wc.debugger.isAttached()) throw new Error(`couldn't attach to the page (${(e as Error).message}): is its DevTools open?`)
    }
    attached.add(wc)
    wc.debugger.on("detach", () => attached.delete(wc))
  }
  return (await wc.debugger.sendCommand(method, params)) as T
}

// ---------- snapshots ----------

type AXValue = { value?: unknown }
type AXNode = { nodeId: string; ignored?: boolean; role?: AXValue; name?: AXValue; value?: AXValue; childIds?: string[]; backendDOMNodeId?: number
  properties?: { name: string; value: AXValue }[] }
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "tab", "treeitem", "listbox"])
const SKIP = new Set(["none", "generic", "InlineTextBox", "LineBreak", "presentation", "LayoutTable", "LayoutTableRow", "LayoutTableCell"])
/** Each page's refs from its last snapshot: "e12" → its DOM node. */
const refs = new WeakMap<WebContents, Map<string, number>>()
const MAX_SNAPSHOT = 60_000

async function snapshot(p: EnginePage) {
  await cdp(p.wc, "Accessibility.enable")
  const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getFullAXTree")
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const kids = new Set(nodes.flatMap((n) => n.childIds ?? []))
  const root = nodes.find((n) => !kids.has(n.nodeId)) ?? nodes[0]
  const map = new Map<string, number>()
  const lines: string[] = []
  let n = 0, size = 0, cut = false
  const text = (v: AXValue | undefined) => (typeof v?.value === "string" ? v.value : v?.value == null ? "" : String(v.value)).replace(/\s+/g, " ").trim()
  const walk = (node: AXNode | undefined, depth: number) => {
    if (!node || cut) return
    const role = text(node.role), name = text(node.name).slice(0, 200)
    const shown = !node.ignored && !SKIP.has(role) && !(role === "StaticText" && !name)
    let d = depth
    if (shown) {
      const props = Object.fromEntries((node.properties ?? []).map((x) => [x.name, x.value?.value]))
      let line = `${"  ".repeat(depth)}- ${role === "StaticText" ? "text" : role}${name ? ` "${name.replace(/"/g, "'")}"` : ""}`
      if ((INTERACTIVE.has(role) || (props.focusable === true && !!name)) && node.backendDOMNodeId) {
        const ref = `e${++n}`
        map.set(ref, node.backendDOMNodeId)
        line += ` [ref=${ref}]`
      }
      const value = text(node.value)
      if (value && value !== name) line += `: ${value.slice(0, 200)}`
      for (const k of ["checked", "pressed", "expanded", "selected", "disabled"]) if (props[k] === true || props[k] === "true" || props[k] === "mixed") line += ` [${k}]`
      size += line.length + 1
      if (size > MAX_SNAPSHOT) { cut = true; lines.push(`${"  ".repeat(depth)}… (cut short: \`vau browser read\` gives the page's text)`); return }
      lines.push(line)
      d = depth + 1
    }
    for (const c of node.childIds ?? []) walk(byId.get(c), d)
  }
  walk(root, 0)
  refs.set(p.wc, map)
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), snapshot: lines.join("\n") }
}

// ---------- acting, with real input ----------

async function nodeOf(p: EnginePage, ref: unknown) {
  const id = refs.get(p.wc)?.get(String(ref))
  if (!id) throw new Error(`no ref ${String(ref)} in this tab's last snapshot: take one (\`vau browser snapshot ${p.id}\`)`)
  try { await cdp(p.wc, "DOM.scrollIntoViewIfNeeded", { backendNodeId: id }) } catch { throw new Error(`ref ${String(ref)} is gone from the page: take a new snapshot`) }
  const { model } = await cdp<{ model: { content: number[] } }>(p.wc, "DOM.getBoxModel", { backendNodeId: id })
  const q = model.content
  return { id, x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
}
/** What the element knows of itself (its kind, whether it's checked), read without running the page's code. */
async function describe(p: EnginePage, id: number) {
  const { node } = await cdp<{ node: { nodeName: string; attributes?: string[] } }>(p.wc, "DOM.describeNode", { backendNodeId: id })
  const attrs: Record<string, string> = {}
  for (let i = 0; i + 1 < (node.attributes ?? []).length; i += 2) attrs[node.attributes![i]] = node.attributes![i + 1]
  return { tag: node.nodeName.toLowerCase(), attrs }
}

/** A dot where the agent clicks, so whoever watches sees it (drawn in a world of its own, never the page's). */
const pointAt = (p: EnginePage, x: number, y: number) => p.wc.executeJavaScriptInIsolatedWorld(1010, [{ code: `(() => {
  const d = document.createElement("div")
  d.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;" +
    "background:rgba(175,82,222,.35);border:2px solid rgb(175,82,222);transition:transform .5s,opacity .5s;left:${Math.round(x)}px;top:${Math.round(y)}px"
  document.documentElement.append(d)
  requestAnimationFrame(() => { d.style.transform = "scale(1.8)"; d.style.opacity = "0" })
  setTimeout(() => d.remove(), 700)
})()` }]).catch(() => {})

async function click(p: EnginePage, x: number, y: number, count = 1) {
  void pointAt(p, x, y)
  await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  for (let i = 1; i <= count; i++) {
    await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: i })
    await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: i })
  }
}

const KEYS: Record<string, { code: string; key: string; vk: number; text?: string }> = {
  enter: { code: "Enter", key: "Enter", vk: 13, text: "\r" }, tab: { code: "Tab", key: "Tab", vk: 9 }, escape: { code: "Escape", key: "Escape", vk: 27 },
  backspace: { code: "Backspace", key: "Backspace", vk: 8 }, delete: { code: "Delete", key: "Delete", vk: 46 }, space: { code: "Space", key: " ", vk: 32, text: " " },
  arrowup: { code: "ArrowUp", key: "ArrowUp", vk: 38 }, arrowdown: { code: "ArrowDown", key: "ArrowDown", vk: 40 },
  arrowleft: { code: "ArrowLeft", key: "ArrowLeft", vk: 37 }, arrowright: { code: "ArrowRight", key: "ArrowRight", vk: 39 },
  home: { code: "Home", key: "Home", vk: 36 }, end: { code: "End", key: "End", vk: 35 }, pageup: { code: "PageUp", key: "PageUp", vk: 33 },
  pagedown: { code: "PageDown", key: "PageDown", vk: 34 },
}
/** A key with modifiers ("Enter", "Meta+a", "Shift+Tab"). */
async function press(p: EnginePage, combo: string) {
  const parts = combo.split("+").map((x) => x.trim()).filter(Boolean)
  const last = parts.pop() ?? ""
  const mods = parts.map((m) => m.toLowerCase())
  const modifiers = (mods.includes("alt") ? 1 : 0) | (mods.includes("control") || mods.includes("ctrl") ? 2 : 0) | (mods.includes("meta") || mods.includes("cmd") ? 4 : 0) | (mods.includes("shift") ? 8 : 0)
  const k = KEYS[last.toLowerCase()] ?? (last.length === 1
    ? { code: /[a-z]/i.test(last) ? `Key${last.toUpperCase()}` : /\d/.test(last) ? `Digit${last}` : "", key: last, vk: last.toUpperCase().charCodeAt(0), text: last }
    : null)
  if (!k) throw new Error(`no key "${last}": Enter, Tab, Escape, Backspace, Delete, Space, arrows, Home, End, PageUp, PageDown or one character`)
  const text = modifiers & ~8 ? undefined : k.text
  await cdp(p.wc, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp(p.wc, "Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers })
}

/** After an action: a moment for what it started (a navigation, a menu) to settle. */
async function settle(p: EnginePage, was: string) {
  const until = Date.now() + 8000
  await new Promise((r) => setTimeout(r, 250))
  while (Date.now() < until && !p.wc.isDestroyed() && p.wc.isLoading()) await new Promise((r) => setTimeout(r, 100))
  const url = p.wc.isDestroyed() ? "" : p.wc.getURL()
  return { tab: p.id, url, title: p.wc.isDestroyed() ? "" : p.wc.getTitle(), navigated: url !== was }
}

type Act = { action: string; ref?: string; value?: string; key?: string; direction?: string }
async function act(p: EnginePage, a: Act) {
  const was = p.wc.getURL()
  const need = (v: unknown, what: string) => { if (v === undefined || v === null || v === "") throw new Error(`${a.action} needs ${what}`); return v }
  switch (a.action) {
    case "click": case "dblclick": case "hover": {
      const n = await nodeOf(p, need(a.ref, "a ref"))
      if (a.action === "hover") { void pointAt(p, n.x, n.y); await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x: n.x, y: n.y }) }
      else await click(p, n.x, n.y, a.action === "dblclick" ? 2 : 1)
      break
    }
    case "fill": case "type": {
      const n = await nodeOf(p, need(a.ref, "a ref"))
      await click(p, n.x, n.y)
      await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {})
      // (fill: what's there goes first, as a person selecting it all would)
      if (a.action === "fill") { await press(p, process.platform === "darwin" ? "Meta+a" : "Control+a"); await press(p, "Backspace") }
      if (a.value) await cdp(p.wc, "Input.insertText", { text: String(a.value) })
      break
    }
    case "press": {
      if (a.ref) { const n = await nodeOf(p, a.ref); await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {}) }
      await press(p, String(need(a.key ?? a.value, "a key")))
      break
    }
    case "check": case "uncheck": {
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: n.id, fetchRelatives: false })
      const checked = nodes[0]?.properties?.find((x) => x.name === "checked")?.value?.value
      if ((checked === true || checked === "true") !== (a.action === "check")) await click(p, n.x, n.y)
      break
    }
    case "select": {
      // A list's option, picked as a person would: the list focused and the option's name typed (a Mac opens a list on
      // an arrow key, and typing picks without opening it).
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const want = String(need(a.value, "a value"))
      const d = await describe(p, n.id)
      if (d.tag !== "select") throw new Error("select is for a list (a <select>): click the option instead")
      type DomNode = { nodeName: string; nodeValue?: string; children?: DomNode[] }
      const { node } = await cdp<{ node: DomNode }>(p.wc, "DOM.describeNode", { backendNodeId: n.id, depth: -1 })
      const textOf = (x: DomNode): string => (x.nodeValue ?? "") + (x.children ?? []).map(textOf).join("")
      const all = (x: DomNode): DomNode[] => [x, ...(x.children ?? []).flatMap(all)]
      const options = all(node).filter((x) => x.nodeName === "OPTION").map((x) => textOf(x).replace(/\s+/g, " ").trim())
      const at = options.findIndex((o) => o === want || o.trim() === want.trim())
      if (at < 0) throw new Error(`no option "${want}" there: ${options.slice(0, 20).join(", ")}`)
      await cdp(p.wc, "DOM.focus", { backendNodeId: n.id })
      for (const ch of options[at]) await cdp(p.wc, "Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch })
      break
    }
    case "scroll": {
      const n = a.ref ? await nodeOf(p, a.ref) : null
      const dy = { up: -600, down: 600 }[String(a.direction ?? "down")] ?? 600
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: n?.x ?? 400, y: n?.y ?? 300, deltaX: 0, deltaY: dy })
      break
    }
    default: throw new Error(`no action "${a.action}": click, dblclick, hover, fill, type, press, check, uncheck, select or scroll`)
  }
  return settle(p, was)
}

// ---------- what agents did, kept for replay (this Mac's userData, never the vault) ----------

const RUNS = () => path.join(app.getPath("userData"), "agent-runs")
const KEEP_DAYS = 14
/** Who asked: the agent's name and its session (the op's caller), a run each a day. */
type By = { name?: string; session?: string }
const runOf = (by: By) => `${new Date().toISOString().slice(0, 10)}-${String(by.session || by.name || "agent").replace(/[^\w.-]+/g, "_").slice(0, 60)}`

async function record(p: EnginePage, by: By, step: Record<string, unknown>) {
  try {
    const dir = path.join(RUNS(), runOf(by))
    fs.mkdirSync(dir, { recursive: true })
    const t = Date.now()
    let shot = ""
    if (p.visible() && !p.wc.isDestroyed()) {
      const img = await p.wc.capturePage().catch(() => null)
      if (img && !img.isEmpty()) {
        shot = `${t}.jpg`
        const { width } = img.getSize()
        fs.writeFileSync(path.join(dir, shot), (width > 1200 ? img.resize({ width: 1200 }) : img).toJPEG(70))
      }
    }
    fs.appendFileSync(path.join(dir, "steps.jsonl"), JSON.stringify({ t, tab: p.id, by: by.name ?? "", url: p.wc.getURL(), title: p.wc.getTitle(), ...step, ...(shot ? { shot } : {}) }) + "\n")
  } catch (e) { console.error("vaultite: an agent's step wasn't kept:", e) }
}
setTimeout(() => {
  try {
    const old = Date.now() - KEEP_DAYS * 86400_000
    for (const d of fs.readdirSync(RUNS())) {
      const day = Date.parse(d.slice(0, 10))
      if (Number.isFinite(day) && day < old) fs.rmSync(path.join(RUNS(), d), { recursive: true, force: true })
    }
  } catch { /* none yet */ }
}, 60_000).unref()

/** Tell the window an agent is at work in a tab (its bar shows who and what, a moment). */
const acting = (p: EnginePage, by: By, what: string) => tell(p.win, { type: "engine:agent:acting", id: p.id, by: by.name || "An agent", what })

/** An element's name for the log ("Sign in"), from the last snapshot's refs. */
async function nameOf(p: EnginePage, ref: unknown) {
  const id = refs.get(p.wc)?.get(String(ref))
  if (!id) return ""
  try {
    const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false })
    const v = nodes[0]?.name?.value
    return typeof v === "string" ? v.slice(0, 80) : ""
  } catch { return "" }
}

// ---------- the calls ----------

const byOf = (x: unknown): By => (x && typeof x === "object" ? { name: String((x as By).name ?? "") || undefined, session: String((x as By).session ?? "") || undefined } : {})
const listOf = () => allPages().filter((p) => !p.wc.isDestroyed() && /^https?:/i.test(p.wc.getURL() || p.url)).map((p) => ({
  tab: p.id, url: p.wc.getURL() || p.url, title: p.wc.getTitle(), container: p.profile.startsWith("c-") ? p.profile.slice(2) : null,
  access: accessOf(p), shown: p.visible(), ...(paused.has(p.id) ? { paused: true } : {}),
}))

// The app's: what agents may do in each profile, and where their tabs open.
handle("agents:access", (_win, map, where) => {
  const next = new Map<string, Access>()
  if (map && typeof map === "object") for (const [k, v] of Object.entries(map)) if (/^[a-z0-9-]{1,32}$/.test(k) && (v === "read" || v === "act")) next.set(k, v)
  access = next
  home = typeof where === "string" && next.get(where) === "act" ? where : [...next].find(([, v]) => v === "act")?.[0] ?? ""
})
handle("agents:pause", (_win, id, on) => {
  if (on) paused.add(Number(id)); else paused.delete(Number(id))
  for (const p of allPages()) if (p.id === Number(id)) tell(p.win, { type: "engine:agent:paused", id: p.id, on: !!on })
})
handle("agents:runs", () => {
  try {
    return fs.readdirSync(RUNS()).sort().reverse().slice(0, 100).flatMap((d) => {
      try {
        const lines = fs.readFileSync(path.join(RUNS(), d, "steps.jsonl"), "utf8").trim().split("\n")
        const first = JSON.parse(lines[0]), last = JSON.parse(lines[lines.length - 1])
        return [{ run: d, by: first.by as string, steps: lines.length, start: first.t as number, end: last.t as number, title: last.title as string, url: last.url as string }]
      } catch { return [] }
    })
  } catch { return [] }
})
handle("agents:run", (_win, run) => {
  const name = String(run)
  if (!/^[\w.-]+$/.test(name)) throw new Error("no such run")
  const dir = path.join(RUNS(), name)
  const steps = fs.readFileSync(path.join(dir, "steps.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
  return steps.map((s) => ({ ...s, shot: typeof s.shot === "string" && /^\d+\.jpg$/.test(s.shot) ? `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, s.shot)).toString("base64")}` : null }))
})

// The server's (its agents', checked here whatever the server says).
handle("agent:tabs", () => listOf())
handle("agent:open", async (win, url, container, by) => {
  const u = String(url ?? "")
  if (!/^https?:\/\//i.test(u)) throw new Error("only http and https addresses")
  const profile = container ? `c-${String(container)}` : home
  if (!profile) throw new Error("no container lets agents act: set one's Agents to Act (the container menu in a page's bar)")
  if (access.get(profile) !== "act" || !mayOpen(profile)) throw new Error(`agents may not act in ${container ? `the container ${String(container)}` : "that container"}`)
  const before = Math.max(0, ...allPages().map((p) => p.id))
  tell(win, { type: "engine:agent:open", url: u, profile, by: byOf(by).name ?? "" })
  const until = Date.now() + 20_000
  for (;;) {
    const p = allPages().find((x) => x.id > before && x.profile === profile && x.url === u) ?? allPages().find((x) => x.profile === profile && x.wc.getURL() === u)
    if (p) {
      while (Date.now() < until && p.wc.isLoading()) await new Promise((r) => setTimeout(r, 100))
      void record(p, byOf(by), { action: "open", value: u })
      return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
    }
    if (Date.now() > until) throw new Error("the tab didn't open: is the vault's window open?")
    await new Promise((r) => setTimeout(r, 150))
  }
})
handle("agent:snapshot", (_win, tab) => snapshot(pageFor(tab, "read")))
handle("agent:read", async (_win, tab) => {
  const p = pageFor(tab, "read")
  const r = await p.wc.executeJavaScriptInIsolatedWorld(1011, [{ code: "({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' })" }]) as { url: string; title: string; text: string }
  return { tab: p.id, ...r, text: r.text.length > 200_000 ? `${r.text.slice(0, 200_000)}\n… (cut short)` : r.text }
})
handle("agent:screenshot", async (_win, tab) => {
  const p = pageFor(tab, "read")
  if (!p.visible()) throw new Error("the tab isn't on screen: show it first (agents' tabs open beside yours)")
  const img = await p.wc.capturePage()
  if (img.isEmpty()) throw new Error("the page drew nothing yet")
  return { tab: p.id, png: img.toPNG().toString("base64") }
})
handle("agent:wait", async (_win, tab, what, ms) => {
  const p = pageFor(tab, "read")
  const w = (what && typeof what === "object" ? what : {}) as { text?: string; url?: string }
  const wait = Math.min(60_000, Math.max(100, Number(ms) || 10_000)), until = Date.now() + wait
  const code = `(() => { const t = ${JSON.stringify(String(w.text ?? ""))}; return !t || (document.body?.innerText ?? "").includes(t) })()`
  for (;;) {
    const ok = (!w.url || p.wc.getURL().includes(String(w.url))) && !p.wc.isLoading() && await p.wc.executeJavaScriptInIsolatedWorld(1012, [{ code }]).catch(() => false)
    if (ok) return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
    if (Date.now() > until) throw new Error(`waited ${Math.round(wait / 1000)} s: ${w.text ? `no "${w.text}"` : w.url ? `not at ${w.url}` : "still loading"}`)
    await new Promise((r) => setTimeout(r, 200))
  }
})
handle("agent:navigate", async (_win, tab, to, by) => {
  const p = pageFor(tab, "act"), was = p.wc.getURL(), t = String(to ?? "")
  if (!["back", "forward", "reload"].includes(t) && !/^https?:\/\//i.test(t)) throw new Error("an http(s) address, back, forward or reload")
  acting(p, byOf(by), t === "back" ? "going back" : t === "forward" ? "going forward" : t === "reload" ? "reloading" : `opening ${t}`)
  const h = p.wc.navigationHistory
  if (t === "back") { if (h.canGoBack()) h.goBack() } else if (t === "forward") { if (h.canGoForward()) h.goForward() }
  else if (t === "reload") p.wc.reload()
  else void p.wc.loadURL(t).catch(() => {})
  const r = await settle(p, was)
  void record(p, byOf(by), { action: "navigate", value: t })
  return r
})
// (any tab, whatever its container lets agents do: it moves the page to a window, nothing in it is read or done)
handle("agent:player", (_win, tab, on, fullScreen) => {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("only a web page opens as a player")
  p.player(on !== false, fullScreen !== false)
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
})
handle("agent:act", async (_win, tab, a, by) => {
  const p = pageFor(tab, "act")
  const step = (a && typeof a === "object" ? a : {}) as Act
  const who = byOf(by), name = step.ref ? await nameOf(p, step.ref) : ""
  // (what's typed into a password field isn't kept)
  const id = step.ref ? refs.get(p.wc)?.get(String(step.ref)) : undefined
  const secret = id ? await describe(p, id).then((d) => d.attrs.type === "password", () => false) : false
  acting(p, who, `${step.action}${name ? ` “${name}”` : ""}`)
  const r = await act(p, step)
  void record(p, who, { action: step.action, ref: step.ref, name, value: secret ? "•••" : step.value ?? step.key ?? step.direction })
  return r
})

// A page that ends isn't paused any more.
eachPage((p) => p.wc.once("destroyed", () => paused.delete(p.id)))
