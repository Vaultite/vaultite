// Agents in the browser, asked by the vault's server (plugins/core/web-viewer/plugin.ts): a page's accessibility tree with
// refs, real input on them over the DevTools protocol (no page scripts), scripts of those in a sandbox; access checked here.
import { app, session, WebContentsView, type Session, type WebContents } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { allPages, busyWhen, cdp, eachPage, eachSession, engineBusy, handle, keepPage, mayOpen, tell, type EnginePage } from "./engine.ts"
import { docOf, exposed, filling, heldNear, markRan, scrub, scrubDeep } from "./pagesecrets.ts"

type Access = "none" | "read" | "act"
/** By profile; a profile not named is none. `home`: where an agent's new tab opens unless it names a container. */
let access = new Map<string, Access>()
let home = ""
/** Pages the user paused agents in (the bar's Stop), till they resume. */
const paused = new Set<number>()
/** Who opened each agent's page (the others are the user's). */
const owners = new Map<number, By>()
/** Pages an agent asked the user to do something in (sign in, a check), till they say it's done; and who waits on it. */
const asks = new Map<number, { by: string; reason: string }>()
const helpWaits = new Map<number, Set<() => void>>()

const accessOf = (p: EnginePage): Access => (!mayOpen(p.profile) ? "none" : access.get(p.profile) ?? "none")
const levels: Record<Access, number> = { none: 0, read: 1, act: 2 }

/** The page `tab` if agents may `need` there, else why not. */
export function pageFor(tab: unknown, need: "read" | "act"): EnginePage {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  const a = accessOf(p)
  if (levels[a] < levels[need]) {
    throw new Error(a === "none"
      ? "agents may not use this tab: its container doesn't let them (Agents, in the container menu of the page's bar)"
      : "agents may only read this tab: its container lets them read, not act")
  }
  if (need === "act" && paused.has(p.id)) throw new Error("the user paused agents in this tab")
  if (need === "act" && filling.has(p.id)) throw new Error("the app is filling a login in this tab: try again in a moment")
  // (an extension's own page, Focus's blocked page and its ask for time among them, is the user's alone)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("agents use web pages only, not an extension's or the app's")
  return p
}

// ---------- snapshots ----------

type AXValue = { value?: unknown }
type AXNode = { nodeId: string; ignored?: boolean; role?: AXValue; name?: AXValue; value?: AXValue; childIds?: string[]; backendDOMNodeId?: number
  properties?: { name: string; value: AXValue }[] }
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "tab", "treeitem", "listbox"])
const SKIP = new Set(["none", "generic", "InlineTextBox", "LineBreak", "presentation", "LayoutTable", "LayoutTableRow", "LayoutTableCell"])
/** Each page's refs: an element keeps its ref while its document lasts, so refs stay good from one snapshot to the next
 *  and a diff shows only what changed. Never reused in a page: a new document's go on from the last one's. */
type Refs = { byRef: Map<string, number>; byNode: Map<number, string>; n: number }
const refs = new WeakMap<WebContents, Refs>()
const refsOf = (wc: WebContents) => {
  let r = refs.get(wc)
  if (!r) refs.set(wc, (r = { byRef: new Map(), byNode: new Map(), n: 0 }))
  return r
}
/** Each page's tree as an agent last saw it, and which document it was (docOf): what act's diff is against. */
const seen = new WeakMap<WebContents, { lines: string[]; doc: number }>()
eachPage((p) => p.wc.on("did-navigate", () => {
  const r = refs.get(p.wc)
  r?.byRef.clear()
  r?.byNode.clear()
}))
const MAX_SNAPSHOT = 60_000
const MAX_TREE = 1_000_000

/** The page's accessibility tree, a line per node shown, its controls with refs. */
async function tree(p: EnginePage) {
  await cdp(p.wc, "Accessibility.enable")
  const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getFullAXTree")
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const kids = new Set(nodes.flatMap((n) => n.childIds ?? []))
  const root = nodes.find((n) => !kids.has(n.nodeId)) ?? nodes[0]
  const r = refsOf(p.wc)
  const lines: string[] = []
  let size = 0
  const text = (v: AXValue | undefined) => (typeof v?.value === "string" ? v.value : v?.value == null ? "" : String(v.value)).replace(/\s+/g, " ").trim()
  const walk = (node: AXNode | undefined, depth: number) => {
    if (!node || size > MAX_TREE) return
    const role = text(node.role), name = text(node.name).slice(0, 200)
    const shown = !node.ignored && !SKIP.has(role) && !(role === "StaticText" && !name)
    let d = depth
    if (shown) {
      const props = Object.fromEntries((node.properties ?? []).map((x) => [x.name, x.value?.value]))
      let line = `${"  ".repeat(depth)}- ${role === "StaticText" ? "text" : role}${name ? ` "${name.replace(/"/g, "'")}"` : ""}`
      const id = node.backendDOMNodeId
      if ((INTERACTIVE.has(role) || (props.focusable === true && !!name)) && id) {
        let ref = r.byNode.get(id)
        if (!ref) { ref = `e${++r.n}`; r.byNode.set(id, ref); r.byRef.set(ref, id) }
        line += ` [ref=${ref}]`
      }
      // (a password field's dots say its length: never)
      const value = /^[•●*]+$/.test(text(node.value)) ? "•••" : text(node.value)
      if (value && value !== name) line += `: ${value.slice(0, 200)}`
      for (const k of ["checked", "pressed", "expanded", "selected", "disabled"]) if (props[k] === true || props[k] === "true" || props[k] === "mixed") line += ` [${k}]`
      line = scrub(line)
      size += line.length + 1
      lines.push(line)
      d = depth + 1
    }
    for (const c of node.childIds ?? []) walk(byId.get(c), d)
  }
  walk(root, 0)
  seen.set(p.wc, { lines, doc: docOf(p.wc) })
  return lines
}

const cut = (lines: string[], max = MAX_SNAPSHOT) => {
  let size = 0
  const at = lines.findIndex((l) => (size += l.length + 1) > max)
  return at < 0 ? lines.join("\n") : `${lines.slice(0, at).join("\n")}\n… (cut short: \`vau browser read\` gives the page's text)`
}
async function snapshot(p: EnginePage) {
  const lines = await tree(p)
  return { tab: p.id, url: scrub(p.wc.getURL()), title: scrub(p.wc.getTitle()), snapshot: cut(lines) }
}

/** What changed between two trees: lines gone (-) then new (+), by what they say, not their depth (a wrapper added moves
 *  nothing). */
export function changes(before: string[], after: string[]) {
  const plain = (l: string) => l.trim().replace(/^- /, "")
  const left = new Map<string, number>()
  for (const l of before) left.set(plain(l), (left.get(plain(l)) ?? 0) + 1)
  const added: string[] = []
  for (const l of after.map(plain)) {
    const n = left.get(l) ?? 0
    if (n) left.set(l, n - 1); else added.push(l)
  }
  const gone = before.map(plain).filter((l) => { const n = left.get(l) ?? 0; if (n) left.set(l, n - 1); return n > 0 })
  return [...gone.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)]
}

/** Until the page's DOM is still a moment (300 ms; 2 s at most), so a diff sees what the action drew. */
const quiet = (p: EnginePage) => p.wc.executeJavaScriptInIsolatedWorld(1014, [{ code: `new Promise((done) => {
  let t = setTimeout(end, 300)
  const cap = setTimeout(end, 2000), o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(end, 300) })
  function end() { o.disconnect(); clearTimeout(t); clearTimeout(cap); done(true) }
  o.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
})` }]).catch(() => {})

/** How many changed lines an act answers: summary (30), none (0, no diff taken) or a number. */
const diffLimit = (d: unknown) => (d === "none" ? 0 : /^\d+$/.test(String(d ?? "")) ? Math.min(1000, Number(d)) : 30)

// ---------- downloads, by page: where each landed (the app saves them in Downloads, web.ts) ----------

type Download = { name: string; path: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; at: number }
const downloads = new WeakMap<WebContents, Download[]>()
eachSession((s) => {
  s.on("will-download", (_e, item, wc) => {
    if (!wc) return
    const d: Download = { name: item.getFilename(), path: "", state: "progressing", at: Date.now() }
    downloads.set(wc, [...(downloads.get(wc) ?? []), d].slice(-20))
    item.once("done", (_ev, state) => { d.path = item.getSavePath(); d.state = state })
  })
})
const shownDownload = (d: Download) => ({ name: d.name, state: d.state, ...(d.path ? { path: d.path } : {}) })

// ---------- files given to a page's file input: kept a day in userData, never the vault ----------

const UPLOADS = () => path.join(app.getPath("userData"), "agent-uploads")
const MAX_UPLOAD = 50 << 20
function uploadFiles(files: unknown): string[] {
  const list = Array.isArray(files) ? files as { name?: unknown; data?: unknown }[] : []
  if (!list.length) throw new Error("upload needs files")
  const dir = path.join(UPLOADS(), crypto.randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  let size = 0
  return list.map((f, i) => {
    const data = Buffer.from(String(f?.data ?? ""), "base64")
    if ((size += data.length) > MAX_UPLOAD) throw new Error("upload takes 50 MB at most")
    const name = path.basename(String(f?.name ?? "")).replace(/^\.+/, "") || `file-${i + 1}`
    const file = path.join(dir, name)
    fs.writeFileSync(file, data)
    return file
  })
}

// ---------- acting, with real input ----------

async function nodeOf(p: EnginePage, ref: unknown) {
  const id = refsOf(p.wc).byRef.get(String(ref))
  if (!id) throw new Error(`no ref ${String(ref)} on this tab's page: take a snapshot (\`vau browser snapshot ${p.id}\`)`)
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
/** Copying and cutting: never where a filled secret could be selected (a revealed password). */
const COPY = /^(?:(?:meta|cmd|control|ctrl)\+(?:shift\+)?[cx]|(?:control|ctrl|shift)\+(?:insert|delete))$/i
/** A key with modifiers ("Enter", "Meta+a", "Shift+Tab"). */
export async function press(p: EnginePage, combo: string) {
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

/** After an action: a moment for what it started (a navigation, a menu, a download) to settle. */
export async function settle(p: EnginePage, was: string, since = Date.now()) {
  const until = Date.now() + 8000
  await new Promise((r) => setTimeout(r, 250))
  while (Date.now() < until && !p.wc.isDestroyed() && p.wc.isLoading()) await new Promise((r) => setTimeout(r, 100))
  const started = () => (downloads.get(p.wc) ?? []).filter((d) => d.at >= since)
  const short = Date.now() + 5000
  while (Date.now() < short && started().some((d) => d.state === "progressing")) await new Promise((r) => setTimeout(r, 100))
  const url = p.wc.isDestroyed() ? "" : p.wc.getURL()
  const got = started()
  return { tab: p.id, url: scrub(url), title: p.wc.isDestroyed() ? "" : scrub(p.wc.getTitle()), navigated: url !== was, ...(got.length ? { downloads: got.map(shownDownload) } : {}) }
}

type Field = { ref: string; value: string }
type Act = { action: string; ref?: string; value?: string; key?: string; direction?: string; files?: unknown; fields?: Field[]; diff?: unknown }
/** One action, with real input, not waiting for what it started. */
async function step(p: EnginePage, a: Act) {
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
      const key = String(need(a.key ?? a.value, "a key")).replace(/\s+/g, "")
      if (COPY.test(key) && heldNear(p)) throw new Error("no copying in a page the app filled a login in")
      if (a.ref) { const n = await nodeOf(p, a.ref); await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {}) }
      await press(p, key)
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
    case "upload": {
      // (into a file input as a person's pick would: Chromium gives the page the files, no dialog)
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const d = await describe(p, n.id)
      if (d.tag !== "input" || d.attrs.type !== "file") throw new Error("upload is for a file input (<input type=file>): its ref, from the snapshot")
      await cdp(p.wc, "DOM.setFileInputFiles", { backendNodeId: n.id, files: uploadFiles(a.files) })
      break
    }
    case "scroll": {
      const n = a.ref ? await nodeOf(p, a.ref) : null
      const dy = { up: -600, down: 600 }[String(a.direction ?? a.value ?? "down")] ?? 600
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: n?.x ?? 400, y: n?.y ?? 300, deltaX: 0, deltaY: dy })
      break
    }
    default: throw new Error(`no action "${a.action}": click, dblclick, hover, fill, type, press, check, uncheck, select, upload or scroll`)
  }
}

/** A form's fields, each as its control takes it: typed into a text field, picked in a list, checked or unchecked (true or
 *  false). Every ref is checked first, so a wrong one fills nothing. */
async function fillForm(p: EnginePage, fields: Field[]) {
  const ids = fields.map((f) => {
    const id = refsOf(p.wc).byRef.get(f.ref)
    if (!id) throw new Error(`no ref ${f.ref} on this tab's page: take a snapshot (\`vau browser snapshot ${p.id}\`)`)
    return id
  })
  for (const [i, f] of fields.entries()) {
    const d = await describe(p, ids[i]), type = (d.attrs.type ?? "").toLowerCase(), role = d.attrs.role ?? ""
    if (d.tag === "input" && type === "file") throw new Error(`${f.ref} is a file input: upload into it (action upload)`)
    if (d.tag === "select") await step(p, { action: "select", ref: f.ref, value: f.value })
    else if ((d.tag === "input" && (type === "checkbox" || type === "radio")) || ["checkbox", "radio", "switch"].includes(role)) {
      await step(p, { action: /^(true|yes|on|1|checked)$/i.test(f.value.trim()) ? "check" : "uncheck", ref: f.ref })
    } else await step(p, { action: "fill", ref: f.ref, value: f.value })
  }
}

/** The fields given (a list of { ref, value }), checked. */
const fieldsOf = (x: unknown): Field[] => {
  if (!Array.isArray(x) || !x.length) throw new Error("fields: a list of { ref, value }")
  return x.slice(0, 200).map((f: { ref?: unknown; value?: unknown }) => {
    if (!f || typeof f !== "object" || !String(f.ref ?? "").trim()) throw new Error("fields: each needs a ref (e12) and its value")
    return { ref: String(f.ref).trim(), value: typeof f.value === "string" ? f.value : f.value == null ? "" : String(f.value) }
  })
}

/** An action (or a whole form, `fields`) settled: where the tab is, what it downloaded, and what changed on the page since
 *  the agent last saw it (`diff`: lines, or the new page's when it went to another; none takes no tree). */
async function act(p: EnginePage, a: Act) {
  const limit = diffLimit(a.diff)
  if (limit && !seen.has(p.wc)) await tree(p)
  const before = seen.get(p.wc), was = p.wc.getURL(), since = Date.now()
  if (a.fields) await fillForm(p, fieldsOf(a.fields)); else await step(p, a)
  const r = await settle(p, was, since)
  if (!limit || p.wc.isDestroyed()) return r
  await quiet(p)
  const lines = await tree(p).catch(() => null)
  if (!lines) return r
  const page = !before || before.doc !== docOf(p.wc)
  const all = page ? lines : changes(before.lines, lines)
  return { ...r, navigated: r.navigated || page, diff: { page, lines: all.slice(0, limit), more: Math.max(0, all.length - limit) } }
}

// ---------- what agents did, kept for replay (this Mac's userData, never the vault) ----------

const RUNS = () => path.join(app.getPath("userData"), "agent-runs")
const KEEP_DAYS = 14
/** Who asked: the agent's name, its session (the op's caller), the task it named and what it said it's doing (`summary`,
 *  given on open), a run each a day. */
type By = { name?: string; session?: string; task?: string; summary?: string }
const runOf = (by: By) => `${new Date().toISOString().slice(0, 10)}-${[by.session || by.name || "agent", by.task].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_").slice(0, 80)}`
/** An agent's tabs' group in the window, Neo's way: "<agent>/<task>". */
const groupOf = (by: By) => [by.name || "Agent", by.task].filter(Boolean).join("/")
const sameAgent = (a: By, b: By) => (a.name ?? "") === (b.name ?? "") && (a.session ?? "") === (b.session ?? "") && (!b.task || a.task === b.task)
/** Each page's last step, for the live list: who, in which run, and what. */
const latest = new Map<number, { by: By; run: string; t: number; step: Record<string, unknown> }>()
/** Live: a page an agent opened, or did something in this last while. */
const LIVE_MS = 120_000

export async function record(p: EnginePage, asked: By, step: Record<string, unknown>) {
  // (a step not naming its task is the one the tab was opened for)
  const owner = owners.get(p.id)
  const by = { ...asked, task: asked.task || owner?.task, summary: asked.summary || (owner && sameAgent(owner, asked) ? owner.summary : undefined) }
  const run = runOf(by), t = Date.now()
  latest.set(p.id, { by, run, t, step })
  lastStep = t
  try {
    const dir = path.join(RUNS(), run)
    fs.mkdirSync(dir, { recursive: true })
    let shot = ""
    // (no picture of a page showing a filled secret: the runs are files on this Mac)
    if (p.visible() && !p.wc.isDestroyed() && !await exposed(p)) {
      const img = await p.wc.capturePage().catch(() => null)
      if (img && !img.isEmpty()) {
        shot = `${t}.jpg`
        const { width } = img.getSize()
        fs.writeFileSync(path.join(dir, shot), (width > 1200 ? img.resize({ width: 1200 }) : img).toJPEG(70))
      }
    }
    fs.appendFileSync(path.join(dir, "steps.jsonl"), scrub(JSON.stringify({ t, tab: p.id, by: by.name ?? "", ...(by.task ? { task: by.task } : {}),
      ...(by.summary ? { summary: by.summary } : {}), url: p.wc.getURL(), title: p.wc.getTitle(), ...step, ...(shot ? { shot } : {}) })) + "\n")
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
export const acting = (p: EnginePage, by: By, what: string) => tell(p.win, { type: "engine:agent:acting", id: p.id, by: by.name || "An agent", what })

/** An element's name for the log ("Sign in"), from its ref. */
async function nameOf(p: EnginePage, ref: unknown) {
  const id = refsOf(p.wc).byRef.get(String(ref))
  if (!id) return ""
  try {
    const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false })
    const v = nodes[0]?.name?.value
    return typeof v === "string" ? v.slice(0, 80) : ""
  } catch { return "" }
}
/** What the log keeps of a field: its name, never what's typed into a password field. */
async function logged(p: EnginePage, ref: string | undefined, value: unknown) {
  const id = ref ? refsOf(p.wc).byRef.get(ref) : undefined
  const secret = id ? await describe(p, id).then((d) => d.attrs.type === "password", () => false) : false
  return { name: ref ? await nameOf(p, ref) : "", value: secret ? "•••" : value }
}

// ---------- the calls, the server's and a run's alike ----------

export const byOf = (x: unknown): By => {
  if (!x || typeof x !== "object") return {}
  const s = (k: keyof By, n = 80) => String((x as By)[k] ?? "").replace(/\s+/g, " ").trim().slice(0, n) || undefined
  return { name: s("name"), session: s("session"), task: s("task"), summary: s("summary", 300) }
}

async function actIn(p: EnginePage, a: Act, who: By) {
  if (a.fields) {
    const fields = fieldsOf(a.fields)
    const kept = await Promise.all(fields.map(async (f) => ({ ref: f.ref, ...(await logged(p, f.ref, f.value)) })))
    acting(p, who, `filling ${fields.length === 1 ? "a field" : `${fields.length} fields`}`)
    const r = await act(p, { ...a, action: "fill", fields })
    void record(p, who, { action: "form", fields: kept })
    return r
  }
  const files = a.action === "upload" && Array.isArray(a.files) ? (a.files as { name?: unknown }[]).map((f) => String(f?.name ?? "")).join(", ") : ""
  const kept = await logged(p, a.ref, files || (a.value ?? a.key ?? a.direction))
  acting(p, who, `${a.action}${kept.name ? ` “${kept.name}”` : ""}`)
  const r = await act(p, a)
  void record(p, who, { action: a.action, ref: a.ref, ...kept })
  return r
}

async function readIn(p: EnginePage) {
  const r = await p.wc.executeJavaScriptInIsolatedWorld(1011, [{ code: "({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' })" }]) as { url: string; title: string; text: string }
  const text = scrub(r.text)
  return { tab: p.id, url: scrub(r.url), title: scrub(r.title), text: text.length > 200_000 ? `${text.slice(0, 200_000)}\n… (cut short)` : text }
}

type Wait = { text?: string; url?: string; download?: boolean; helped?: boolean }
async function waitIn(p: EnginePage, w: Wait, ms: unknown) {
  const wait = Math.min(60_000, Math.max(100, Number(ms) || 10_000)), until = Date.now() + wait
  // (the text is looked for here, in what the page shows scrubbed: never an oracle for a filled secret)
  const shows = async () => !w.text || scrub(String(await p.wc.executeJavaScriptInIsolatedWorld(1012, [{ code: "document.body ? document.body.innerText : ''" }]).catch(() => ""))).includes(String(w.text))
  const last = () => (downloads.get(p.wc) ?? []).at(-1)
  if (w.helped && asks.has(p.id)) {
    // (the user's Done ends it at once, not at the next look)
    await new Promise<void>((done) => {
      const set = helpWaits.get(p.id) ?? new Set()
      helpWaits.set(p.id, set)
      const end = () => { clearTimeout(timer); set.delete(end); done() }
      const timer = setTimeout(end, wait)
      set.add(end)
    })
    if (asks.has(p.id)) throw new Error(`waited ${Math.round(wait / 1000)} s: the user hasn't said it's done yet (they still see what you asked): wait again`)
  }
  for (;;) {
    const d = last()
    const ok = (!w.url || scrub(p.wc.getURL()).includes(String(w.url))) && (!w.download || (!!d && d.state !== "progressing")) && !p.wc.isLoading() && await shows()
    if (ok) return { tab: p.id, url: scrub(p.wc.getURL()), title: scrub(p.wc.getTitle()), ...(w.download && d ? { download: shownDownload(d) } : {}) }
    if (Date.now() > until) {
      throw new Error(`waited ${Math.round(wait / 1000)} s: ${w.text ? `no "${w.text}"` : w.url ? `not at ${w.url}` : w.download ? (d ? `${d.name} is still downloading` : "nothing downloaded in this tab") : "still loading"}`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function navigateIn(p: EnginePage, to: unknown, who: By) {
  const was = p.wc.getURL(), t = String(to ?? "")
  if (!["back", "forward", "reload"].includes(t) && !/^https?:\/\//i.test(t)) throw new Error("an http(s) address, back, forward or reload")
  acting(p, who, t === "back" ? "going back" : t === "forward" ? "going forward" : t === "reload" ? "reloading" : `opening ${t}`)
  const h = p.wc.navigationHistory
  if (t === "back") { if (h.canGoBack()) h.goBack() } else if (t === "forward") { if (h.canGoForward()) h.goForward() }
  else if (t === "reload") p.wc.reload()
  else void p.wc.loadURL(t).catch(() => {})
  const r = await settle(p, was)
  void record(p, who, { action: "navigate", value: t })
  return r
}

/** The page's web pages, each with whose it is: an agent's (`by`, and `mine` for the one asking) or the user's. */
const listOf = (asking: By) => allPages().filter((p) => !p.wc.isDestroyed() && /^https?:/i.test(p.wc.getURL() || p.url)).map((p) => {
  const owner = owners.get(p.id)
  return {
    tab: p.id, url: p.wc.getURL() || p.url, title: p.wc.getTitle(), container: p.profile.startsWith("c-") ? p.profile.slice(2) : null,
    access: accessOf(p), shown: p.visible(), by: owner ? groupOf(owner) : null, mine: !!owner && sameAgent(owner, asking),
    ...(owner?.summary ? { summary: owner.summary } : {}),
    ...(paused.has(p.id) ? { paused: true } : {}), ...(asks.has(p.id) ? { asking: asks.get(p.id)!.reason } : {}),
  }
})

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
  window.__run = async (script) => {
    const api = {
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
async function refIn(p: EnginePage, name: unknown, role: unknown) {
  const want = String(name ?? "").trim().toLowerCase(), r = String(role ?? "").trim()
  const hits = (await tree(p)).map((l) => /^\s*- (\S+) "([^"]*)".*\[ref=(e\d+)\]/.exec(l)).filter((m): m is RegExpExecArray => !!m && (!r || m[1] === r))
  const hit = hits.find((m) => m[2].toLowerCase() === want) ?? hits.find((m) => m[2].toLowerCase().includes(want))
  return hit?.[3] ?? null
}

async function runIn(p: EnginePage, script: string, who: By) {
  if (!script.trim()) throw new Error("run needs a script")
  const view = new WebContentsView({ webPreferences: { session: sandboxSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const wc = view.webContents
  wc.setWindowOpenHandler(() => ({ action: "deny" }))
  wc.on("will-navigate", (e) => e.preventDefault())
  // (each call checks the tab's access again: the user may pause agents mid-run)
  const calls: Record<string, (...a: unknown[]) => Promise<unknown>> = {
    snapshot: async () => (await snapshot(pageFor(p.id, "read"))).snapshot,
    act: (a) => actIn(pageFor(p.id, "act"), { diff: "none", ...(a && typeof a === "object" ? a as Act : { action: "" }) }, who),
    ref: (name, role) => refIn(pageFor(p.id, "read"), name, role),
    read: async () => (await readIn(pageFor(p.id, "read"))).text,
    wait: (w) => { const x = (w && typeof w === "object" ? w : {}) as Wait & { timeout?: number }; return waitIn(pageFor(p.id, "read"), x, (Number(x.timeout) || 10) * 1000) },
    go: (to) => navigateIn(pageFor(p.id, "act"), to, who),
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
      .then((v) => answer(m.id, true, v), (err: Error) => answer(m.id, false, err.message))
  })
  acting(p, who, "running a script")
  void record(p, who, { action: "run", value: script.slice(0, 2000) })
  let late = false, timer: NodeJS.Timeout | undefined
  try {
    await wc.loadURL("about:blank")
    await wc.executeJavaScript(BRIDGE)
    const out = await Promise.race([
      wc.executeJavaScript(`window.__run(${JSON.stringify(script)})`) as Promise<{ value?: unknown; error?: string; logs: string[] }>,
      new Promise<never>((_r, fail) => { timer = setTimeout(() => { late = true; fail(new Error(`the script took over ${RUN_MS / 1000} s: it was stopped`)) }, RUN_MS) }),
    ])
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

// ---------- the app's ----------

// What agents may do in each profile, and where their tabs open.
handle("agents:access", (_win, map, where) => {
  const next = new Map<string, Access>()
  if (map && typeof map === "object") for (const [k, v] of Object.entries(map)) if (/^[a-z0-9-]{1,32}$/.test(k) && (v === "read" || v === "act")) next.set(k, v)
  access = next
  home = typeof where === "string" && next.get(where) === "act" ? where : [...next].find(([, v]) => v === "act")?.[0] ?? ""
})
// The user did what an agent asked (the bar's Done, or the live view's), or the tab closed.
export function helped(id: number) {
  if (!asks.delete(id)) return
  for (const p of allPages()) if (p.id === id) tell(p.win, { type: "engine:agent:help", id, on: false })
  for (const done of helpWaits.get(id) ?? []) done()
  helpWaits.delete(id)
}
handle("agents:helped", (_win, id) => helped(Number(id)))
/** Agents paused in page `id` (the bar's Stop, or the live view's), or let go on. */
export function setPaused(id: number, on: boolean) {
  if (on) paused.add(id); else paused.delete(id)
  for (const p of allPages()) if (p.id === id) tell(p.win, { type: "engine:agent:paused", id: p.id, on })
}
handle("agents:pause", (_win, id, on) => setPaused(Number(id), !!on))
/** Whose page `id` is (an agent's, else the user's), whether agents are paused in it and what one asked the user there. */
export const agentState = (id: number) => ({ by: owners.get(id) ?? null, paused: paused.has(id), ask: asks.get(id) ?? null })
// The pages agents are at work in now, each with a small picture of it as it is.
handle("agents:live", async () => {
  const now = Date.now()
  const live = allPages().filter((p) => !p.wc.isDestroyed() && (owners.has(p.id) || (latest.get(p.id)?.t ?? 0) > now - LIVE_MS))
  return Promise.all(live.map(async (p) => {
    const last = latest.get(p.id), by = last?.by ?? owners.get(p.id) ?? {}
    const img = await p.wc.capturePage(undefined, { stayHidden: true }).catch(() => null)
    return {
      tab: p.id, appTab: p.tab(), by: by.name ?? "", task: by.task ?? "", summary: by.summary ?? "", url: p.wc.getURL(), title: p.wc.getTitle(),
      run: last?.run ?? null, at: last?.t ?? null, step: last?.step ?? null, paused: paused.has(p.id), asking: asks.get(p.id)?.reason ?? null,
      shot: img && !img.isEmpty() ? `data:image/jpeg;base64,${img.resize({ width: 640 }).toJPEG(65).toString("base64")}` : null,
    }
  }))
})
handle("agents:runs", () => {
  try {
    return fs.readdirSync(RUNS()).sort().reverse().slice(0, 200).flatMap((d) => {
      try {
        const steps = fs.readFileSync(path.join(RUNS(), d, "steps.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
        const first = steps[0], last = steps[steps.length - 1]
        const said = (k: string) => String(steps.findLast((s) => typeof s[k] === "string" && s[k])?.[k] ?? "")
        return [{ run: d, by: first.by as string, task: said("task"), summary: said("summary"), steps: steps.length, start: first.t as number, end: last.t as number,
          title: last.title as string, url: last.url as string }]
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

// ---------- busy: an update's restart waits till agents are done ----------

/** Agent calls under way (a `run` script among them), and when an agent last did something in a page. */
let inFlight = 0
let lastStep = 0
/** An agent that acted this recently is likely mid-task, between calls. */
const BUSY_MS = 10 * 60_000
keepPage((id) => owners.has(id) || asks.has(id))
// (an ask can wait for days: it holds only the app's restart, which would lose it)
busyWhen(() => asks.size ? "a page waits on the user for an agent" : null, true)
busyWhen(() => inFlight ? "an agent's call is under way"
  : Date.now() - lastStep < BUSY_MS ? "an agent acted in a page in the last 10 minutes" : null)
/** An agent call, counted while it runs. What it answers, or fails with, never has a secret the app filled. */
export const serve = (name: `agent:${string}`, fn: Parameters<typeof handle>[1]) => handle(name, async (...a) => {
  inFlight++
  try { return scrubDeep(await fn(...a)) } catch (e) { throw new Error(scrub((e as Error).message ?? String(e))) } finally { inFlight-- }
})

// ---------- the server's (its agents', checked here whatever the server says) ----------

handle("agent:busy", (_win, of) => { const why = engineBusy(of === "server" ? "server" : "app"); return { busy: !!why, why } })

serve("agent:tabs", (_win, by) => listOf(byOf(by)))
serve("agent:open", async (win, url, container, by) => {
  const u = String(url ?? "")
  if (!/^https?:\/\//i.test(u)) throw new Error("only http and https addresses")
  const profile = container ? `c-${String(container)}` : home
  if (!profile) throw new Error("no container lets agents act: set one's Agents to Act (the container menu in a page's bar)")
  if (access.get(profile) !== "act" || !mayOpen(profile)) throw new Error(`agents may not act in ${container ? `the container ${String(container)}` : "that container"}`)
  const before = Math.max(0, ...allPages().map((p) => p.id)), who = byOf(by)
  tell(win, { type: "engine:agent:open", url: u, profile, by: who.name ?? "", group: groupOf(who) })
  const until = Date.now() + 20_000
  for (;;) {
    const p = allPages().find((x) => x.id > before && x.profile === profile && x.url === u) ?? allPages().find((x) => x.profile === profile && x.wc.getURL() === u)
    if (p) {
      owners.set(p.id, who)
      while (Date.now() < until && p.wc.isLoading()) await new Promise((r) => setTimeout(r, 100))
      void record(p, who, { action: "open", value: u })
      return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
    }
    if (Date.now() > until) throw new Error("the tab didn't open: is the vault's window open?")
    await new Promise((r) => setTimeout(r, 150))
  }
})
serve("agent:snapshot", (_win, tab) => snapshot(pageFor(tab, "read")))
serve("agent:read", (_win, tab) => readIn(pageFor(tab, "read")))
serve("agent:close", async (_win, tab) => {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  if (!owners.has(p.id)) throw new Error("this tab is the user's: agents close only the tabs agents opened")
  tell(p.win, { type: "engine:agent:close", id: p.id, tab: p.tab() })
  const until = Date.now() + 5000
  while (Date.now() < until && !p.wc.isDestroyed()) await new Promise((r) => setTimeout(r, 100))
  if (!p.wc.isDestroyed()) throw new Error("the tab didn't close: is the vault's window open?")
  return { tab: p.id }
})
/** At most this wide, so a picture costs an agent less (a Retina page is twice the size). */
const SHOT_WIDTH = 1280
/** No picture of a page showing a secret the app filled (a revealed password, a one-time code in its field). */
async function unexposed(p: EnginePage) {
  if (await exposed(p)) throw new Error("the page shows a secret the app filled (a password shown, a one-time code): no picture of it now")
  return p
}
serve("agent:screenshot", async (_win, tab) => {
  const p = await unexposed(pageFor(tab, "read"))
  // (a tab in the background is drawn for it, and stays hidden)
  const img = await p.wc.capturePage(undefined, { stayHidden: true })
  if (img.isEmpty()) throw new Error("the page drew nothing yet")
  const { width } = img.getSize()
  return { tab: p.id, png: (width > SHOT_WIDTH ? img.resize({ width: SHOT_WIDTH }) : img).toPNG().toString("base64") }
})
serve("agent:pdf", async (_win, tab, by) => {
  const p = await unexposed(pageFor(tab, "read"))
  const pdf = await p.wc.printToPDF({ printBackground: true })
  if (pdf.length > 50 << 20) throw new Error("the page makes a PDF over 50 MB")
  void record(p, byOf(by), { action: "pdf" })
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), pdf: pdf.toString("base64") }
})
/** Whether a password field the page's code (and so an agent's script) can reach has a value. */
const PASSWORD_GIVEN = `(() => { const any = (root) => [...root.querySelectorAll("*")].some((el) => (el.tagName === "INPUT" && el.type === "password" && el.value)
  || (el.shadowRoot && any(el.shadowRoot)) || ((el.tagName === "IFRAME" || el.tagName === "FRAME") && (() => { try { return !!el.contentDocument && any(el.contentDocument) } catch { return false } })()))
  return any(document) })()`
serve("agent:evaluate", async (_win, tab, expression, by) => {
  const p = pageFor(tab, "act")
  const code = String(expression ?? "")
  if (!code.trim()) throw new Error("evaluate needs an expression")
  const who = byOf(by)
  // Never where it could read a password: one the app filled (its code could also stay, listening, so a page it ran in
  // gets no login till it loads again: pagesecrets.ts), or one in a field now.
  const held = heldNear(p)
  if (held) throw new Error(`evaluate is off in this page: ${held}`)
  if (p.wc.isLoadingMainFrame()) throw new Error("the page is loading: wait for it (browser wait), then evaluate")
  markRan(p)
  if (await p.wc.executeJavaScriptInIsolatedWorld(1015, [{ code: PASSWORD_GIVEN }]).catch(() => true)) {
    throw new Error("evaluate is off in this page: a password field in it has something typed in it")
  }
  acting(p, who, "running a script")
  // A world of its own: the DOM, never the page's scripts or their variables (nor they the agent's).
  const value = await Promise.race([p.wc.executeJavaScriptInIsolatedWorld(1013, [{ code }]),
    new Promise((_r, fail) => setTimeout(() => fail(new Error("the expression took over 30 s")), 30_000))])
  void record(p, who, { action: "evaluate", value: code.slice(0, 500) })
  let json = JSON.stringify(value ?? null) ?? "null"
  if (json.length > 100_000) json = `${json.slice(0, 100_000)}… (cut short)`
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), value: json }
})
serve("agent:run", (_win, tab, script, by) => runIn(pageFor(tab, "act"), String(script ?? ""), byOf(by)))
serve("agent:help", (_win, tab, reason, by) => {
  const p = pageFor(tab, "read")
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300)
  if (!why) throw new Error("say what the user should do (sign in, solve the check)")
  const who = byOf(by)
  asks.set(p.id, { by: who.name || "An agent", reason: why })
  tell(p.win, { type: "engine:agent:help", id: p.id, tab: p.tab(), by: who.name || "An agent", reason: why, on: true })
  void record(p, who, { action: "help", value: why })
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
})
serve("agent:wait", (_win, tab, what, ms) => waitIn(pageFor(tab, "read"), (what && typeof what === "object" ? what : {}) as Wait, ms))
serve("agent:navigate", (_win, tab, to, by) => navigateIn(pageFor(tab, "act"), to, byOf(by)))
// (any tab, whatever its container lets agents do: it moves the page to a window, nothing in it is read or done)
serve("agent:player", (_win, tab, on, fullScreen) => {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("only a web page opens as a player")
  p.player(on !== false, fullScreen !== false)
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
})
serve("agent:act", (_win, tab, a, by) => actIn(pageFor(tab, "act"), (a && typeof a === "object" ? a : {}) as Act, byOf(by)))

// A page that ends isn't paused, anyone's, live or asking any more.
eachPage((p) => p.wc.once("destroyed", () => { paused.delete(p.id); owners.delete(p.id); latest.delete(p.id); helped(p.id) }))
// Files given to file inputs, a day on.
setTimeout(() => {
  try {
    for (const d of fs.readdirSync(UPLOADS())) {
      const at = path.join(UPLOADS(), d)
      if (Date.now() - fs.statSync(at).mtimeMs > 86400_000) fs.rmSync(at, { recursive: true, force: true })
    }
  } catch { /* none yet */ }
}, 60_000).unref()
