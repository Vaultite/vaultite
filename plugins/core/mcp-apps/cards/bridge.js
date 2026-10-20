// The view's side of MCP Apps (2026-01-26): JSON-RPC over postMessage with the host, its theme, and its size.
// Inlined into each card page, whose own script uses these globals.
/* eslint-disable no-unused-vars */
const mcp = (() => {
  let next = 1
  const waiting = new Map(), handlers = {}
  let ctx = {}
  const post = (m) => parent.postMessage({ jsonrpc: "2.0", ...m }, "*")
  addEventListener("message", (e) => {
    if (e.source !== parent) return
    const m = e.data
    if (!m || m.jsonrpc !== "2.0") return
    if (m.method === undefined && m.id !== undefined && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id)
      return m.error ? w.reject(new Error(m.error.message || "failed")) : w.resolve(m.result)
    }
    if (typeof m.method !== "string") return
    if (m.method === "ui/notifications/host-context-changed") apply(m.params || {})
    const fn = handlers[m.method]
    const out = fn ? fn(m.params || {}) : undefined
    if (m.id !== undefined) post({ id: m.id, result: {} }) // ui/resource-teardown, ping
    return out
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++
    waiting.set(id, { resolve, reject })
    post({ id, method, params })
  })
  const notify = (method, params) => post({ method, params })

  // The host's theme: its variables over our fallbacks, its light or dark, its fonts.
  function apply(c) {
    ctx = { ...ctx, ...c }
    const root = document.documentElement
    if (c.theme) { root.dataset.theme = c.theme; root.style.colorScheme = c.theme }
    for (const [k, v] of Object.entries(c.styles?.variables || {})) if (v && k.startsWith("--")) root.style.setProperty(k, v)
    if (c.styles?.css?.fonts && !document.getElementById("host-fonts")) {
      const s = document.createElement("style"); s.id = "host-fonts"; s.textContent = c.styles.css.fonts; document.head.append(s)
    }
    const d = c.containerDimensions
    if (d && "maxHeight" in d && d.maxHeight) root.style.maxHeight = `${d.maxHeight}px`
    if (d && "height" in d) root.style.height = "100vh"
  }

  let last = ""
  const size = () => {
    const r = document.documentElement.getBoundingClientRect()
    const s = `${Math.ceil(r.width)}x${Math.ceil(document.documentElement.scrollHeight)}`
    if (s !== last) { last = s; notify("ui/notifications/size-changed", { width: Math.ceil(r.width), height: Math.ceil(document.documentElement.scrollHeight) }) }
  }

  return {
    on: (method, fn) => { handlers[method] = fn },
    get context() { return ctx },
    async start(name) {
      const r = await request("ui/initialize", { appInfo: { name, version: "1.0.0" }, appCapabilities: { availableDisplayModes: ["inline"] }, protocolVersion: "2026-01-26" })
      apply(r?.hostContext || {})
      notify("ui/notifications/initialized", {})
      new ResizeObserver(size).observe(document.body)
      size()
    },
    /** A tool's CallToolResult; throws its text when it's an error. */
    async call(name, args) {
      const r = await request("tools/call", { name, arguments: args })
      if (r?.isError) throw new Error((r.content || []).map((c) => c.text || "").join("\n") || `${name} failed`)
      return r
    },
    /** Open a link: the first of `urls` the host takes. */
    async open(...urls) {
      for (const url of urls.filter(Boolean)) { try { await request("ui/open-link", { url }); return } catch { /* the next */ } }
    },
    text: (r) => (r?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"),
  }
})()
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** A line of Markdown as plain text: links by their text, no marks. */
const plain = (s) => String(s ?? "").replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]|==/g, "")
