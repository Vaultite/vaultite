// Both functions go as source (Function.toString): nothing outside them is in scope.
import type { Node, Prop } from "./dil.ts"

export type Tree = { t: "md"; s: string; slots?: Tree[] } | { t: "el"; n: string; p: Record<string, unknown>; k: Tree[] } | { t: "app"; p: Record<string, unknown>; html: string }
export type FromSandbox =
  | { g: 1; type: "tree"; tree: Tree[]; errors: string[] }
  | { g: 1; type: "state"; state: Record<string, unknown> }
  | { g: 1; type: "action"; name: string; args: unknown[] }
  | { g: 1; type: "error"; message: string }
  | { g: 1; type: "ready" }
export type Env = { dark: boolean; mobile: boolean; width: number }
export type ToSandbox =
  | { g: 1; type: "run"; nodes: Node[]; names: string[]; state: Record<string, unknown>; bindings?: Record<string, unknown>; env: Env }
  | { g: 1; type: "call"; fn: number; args: unknown[] }
type Posted =
  | { type: "tree"; tree: unknown; errors: string[] }
  | { type: "state"; state: Record<string, unknown> }
  | { type: "action"; name: string; args: unknown }
  | { type: "error"; message: string }
  | { type: "idle" }

export function workerMain(io: { post: (m: unknown) => void; listen: (f: (m: ToSandbox) => void) => void }) {
  for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel"]) {
    try { Object.defineProperty(globalThis, k, { value: undefined, configurable: false, writable: false }) } catch {}
  }
  const post = (m: Posted) => io.post({ g: 1, ...m })
  let render: (() => unknown[]) | null = null
  let names: string[] = []
  let saved: Record<string, unknown> = {}
  let slots: { v?: unknown; deps?: unknown[]; cleanup?: unknown; name?: string }[] = []
  let effects: (() => void)[] = []
  let at = 0
  let stateAt = 0
  let fns: Function[] = []
  let errors: string[] = []
  let queued = false
  let rendering = false
  let stateDirty = false
  let env: Env = { dark: false, mobile: false, width: 800 }
  let ids = 0

  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const schedule = () => { if (!queued && !rendering) { queued = true; Promise.resolve().then(draw) } }
  const DIL = {
    useState(init: unknown, own: unknown = true): [unknown, (v: unknown) => void] {
      const k = at++
      const key = own && typeof own === "object" && "key" in own ? own.key : undefined
      const named = typeof key === "string" ? key : undefined
      const name = own ? (named !== undefined ? (stateAt++, named) : names[stateAt++]) : undefined
      if (!slots[k]) {
        slots[k] = { name, v: name !== undefined && Object.hasOwn(saved, name) ? saved[name] : typeof init === "function" ? init() : init }
      }
      const s = slots[k]
      const set = (v: unknown) => {
        const next = typeof v === "function" ? v(s.v) : v
        if (Object.is(next, s.v)) return
        s.v = next
        stateDirty = true
        schedule()
      }
      return [s.v, set]
    },
    useReducer(reducer: (s: unknown, a: unknown) => unknown, init: unknown) {
      const [v, set] = DIL.useState(init, false)
      return [v, (a: unknown) => set((cur: unknown) => reducer(cur, a))]
    },
    useMemo(fn: () => unknown, deps?: unknown[]) {
      const k = at++
      const s = slots[k]
      if (s && deps && same(s.deps, deps)) return s.v
      slots[k] = { v: fn(), deps }
      return slots[k].v
    },
    useCallback(fn: unknown, deps?: unknown[]) { return DIL.useMemo(() => fn, deps) },
    useRef(init: unknown) { const k = at++; if (!slots[k]) slots[k] = { v: { current: init } }; return slots[k].v },
    useNow(on = true, ms = 1000) {
      const [now, setNow] = DIL.useState(Date.now(), false)
      DIL.useEffect(() => {
        if (!on) return
        const t = setInterval(() => setNow(Date.now()), Math.max(50, ms))
        return () => clearInterval(t)
      }, [on, ms])
      return on ? now : Date.now()
    },
    useTheme() { return { isDark: env.dark, isLight: !env.dark, theme: env.dark ? "dark" : "light" } },
    useIsMobile() { return env.mobile },
    useBreakpoint(bp: string) { return env.width >= (new Map([["xs", 0], ["sm", 640], ["md", 768], ["lg", 1024], ["xl", 1280], ["2xl", 1536]]).get(bp) ?? 0) },
    useId() { const k = at++; if (!slots[k]) slots[k] = { v: `dil-${ids++}` }; return slots[k].v },
    useDictation() { return { supported: false, listening: false, transcript: "", start() {}, stop() {} } },
    useSpeechSynthesizer() { return { supported: false, speaking: false, speak() {}, cancel() {}, stop() {} } },
    useDILMessenger() { return { send() {}, lastMessage: null } },
    useHtmlViewMessenger() { return { send() {}, lastMessage: null } },
    useEffect(fn: () => unknown, deps?: unknown[]) {
      const k = at++
      const s = slots[k]
      if (s && deps && same(s.deps, deps)) return
      const prev = s?.cleanup
      slots[k] = { deps }
      effects.push(() => {
        if (typeof prev === "function") try { prev() } catch {}
        try { slots[k].cleanup = fn() } catch (e) { errors.push(String(e)) }
      })
    },
  }
  const GenUI = new Proxy({}, { get: (_, name) => (...args: unknown[]) => {
    if (name === "runPluginTool" || name === "callTool") return Promise.resolve({ status: "error", message: "Connected apps aren't available in a note" })
    post({ type: "action", name: String(name), args: clone(args) })
    return Promise.resolve()
  } })
  const clone = (v: unknown): unknown => { try { return JSON.parse(JSON.stringify(v ?? null)) } catch { return null } }

  const x = (f: () => unknown, src: string) => {
    try { return f() } catch (e) { errors.push(`${src}: ${e instanceof Error ? e.message : String(e)}`); return undefined }
  }
  const text = (v: unknown): string => {
    if (v === null || v === undefined || v === false || v === true) return ""
    if (Array.isArray(v)) return v.map(text).join("")
    if (typeof v === "object") { try { return JSON.stringify(v) } catch { return "" } }
    return String(v)
  }
  const escape = (s: string) => s.replace(/([\\`*_{}[\]<>()#+!|~$])/g, "\\$1").replace(/^(\s*)(\d+)\./gm, "$1$2\\.").replace(/^(\s*)-/gm, "$1\\-")
  const md = (parts: (string | { el?: unknown; v?: unknown })[]) => {
    const slots: unknown[] = []
    const s = parts.map((p) => (typeof p === "string" ? p : p.el ? `\u2063${slots.push(p.el) - 1}\u2063` : escape(text(p.v)))).join("")
    return slots.length ? { t: "md", s, slots } : { t: "md", s }
  }
  let images = 0
  let maps = 0
  const h = (n: string, p: Record<string, unknown>, k: unknown[]) => ({ t: "el", n, p: n === "AsyncImage" ? { ...p, $n: images++ } : /^Map/.test(n) ? { ...p, $n: maps++ } : p, k })
  const app = (p: Record<string, unknown>, html: string) => ({ t: "app", p, html })
  const each = (list: unknown, f: (item: unknown, i: number) => unknown[]) => {
    const arr = Array.isArray(list) ? list : list && typeof list === "object" ? Object.values(list) : typeof list === "number" ? Array.from({ length: list }, (_, i) => i) : []
    return arr.flatMap((item, i) => f(item, i))
  }

  const J = JSON.stringify
  const expr = (e: string) => `__x(()=>(${e}),${J(e)})`
  const props = (ps: Prop[]) =>
    `{${ps.map((p) => ("spread" in p ? `...${expr(p.spread)}` : `${J(p.name)}:${p.str !== undefined ? J(p.str) : expr(p.e ?? "true")}`)).join(",")}}`
  const gen = (ns: Node[]): string => `(()=>{const __k=[];${ns.map(one).join("\n")}\nreturn __k})()`
  const one = (n: Node): string => {
    if (n.t === "md") return `__k.push(__md([${n.parts.map((p) => (typeof p === "string" ? J(p) : "el" in p ? `{el:${gen([p.el])}[0]}` : `{v:${expr(p.e)}}`)).join(",")}]));`
    if (n.t === "body") return `${safeBody(n.js)}\n;`
    if (n.t === "el") return `__k.push(__h(${J(n.name)},${props(n.props)},${gen(n.kids)}));`
    if (n.t === "app") return `__k.push(__app(${props(n.props)},${J(n.html)}));`
    if (n.t === "each") return `__k.push(...__each(${expr(n.list)},(${n.as},${n.index ?? "__i"})=>${gen(n.kids)}));`
    if (n.t === "if") {
      return n.branches.map((b, i) => `${i ? "else " : ""}${b.test !== null ? `if (${expr(b.test)}) ` : ""}{__k.push(...${gen(b.kids)})}`).join("\n")
    }
    return ""
  }

  // ChatGPT's DIL: a statement whose value throws is undefined (`const s = stages[step]` past the end).
  const safeBody = (js: string) => {
    const m = /^\s*(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)([\s\S]+)$/.exec(js)
    if (!m || /\b(?:DIL|React)\.use[A-Z]\w*\s*\(/.test(m[3]) || !single(m[3])) return js
    return `${m[1]} ${m[2]} = ${expr(m[3].trim().replace(/;\s*$/, ""))}`
  }
  const single = (src: string) => {
    let depth = 0
    const body = src.trim().replace(/;\s*$/, "")
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c === '"' || c === "'" || c === "`") { for (i++; i < body.length && body[i] !== c; i++) if (body[i] === "\\") i++; continue }
      if (c === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) return false
      if (c === "(" || c === "[" || c === "{") depth++
      else if (c === ")" || c === "]" || c === "}") depth--
      else if (depth === 0 && (c === "," || c === ";")) return false
    }
    return depth === 0
  }

  const out = (v: unknown, depth = 0): unknown => {
    if (typeof v === "function") { fns.push(v); return { $fn: fns.length - 1 } }
    if (depth > 40 || v === null || typeof v !== "object") return typeof v === "number" && !Number.isFinite(v) ? null : v
    if (Array.isArray(v)) return v.map((x) => out(x, depth + 1))
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = out(x, depth + 1)
    return o
  }

  function draw() {
    queued = false
    if (!render) return
    for (let pass = 0; pass < 5; pass++) {
      at = 0; stateAt = 0; errors = []; effects = []; fns = []; images = 0; maps = 0
      rendering = true
      let tree: unknown[] = []
      try { tree = render() } catch (e) { rendering = false; post({ type: "error", message: e instanceof Error ? e.message : String(e) }); return }
      rendering = false
      const ran = effects
      effects = []
      ran.forEach((f) => f())
      if (queued) { queued = false; continue }
      post({ type: "tree", tree: out(tree), errors: errors.slice(0, 20) })
      if (stateDirty) {
        stateDirty = false
        const state: Record<string, unknown> = {}
        for (const sl of slots) if (sl?.name && /^[\w$]+$/.test(sl.name)) { const c = clone(sl.v); if (c !== null || sl.v === null) state[sl.name] = c }
        post({ type: "state", state })
      }
      return
    }
    post({ type: "error", message: "it kept redrawing itself" })
  }

  io.listen((m) => {
    if (m.type === "run") {
      names = m.names ?? []
      if (m.env) env = { ...env, ...m.env }
      saved = m.state ?? {}
      for (const sl of slots) if (typeof sl?.cleanup === "function") try { sl.cleanup() } catch {}
      slots = []
      const bound = Object.entries(m.bindings ?? {}).filter(([k]) => /^[A-Za-z_$][\w$]*$/.test(k))
      try {
        // eslint-disable-next-line no-new-func
        const f = new Function("DIL", "React", "GenUI", "__x", "__md", "__h", "__app", "__each", ...bound.map(([k]) => k), `"use strict";\nreturn ${gen(m.nodes)}`)
        render = () => f(DIL, DIL, GenUI, x, md, h, app, each, ...bound.map(([, v]) => v))
      } catch (e) {
        render = null
        post({ type: "error", message: `It doesn't compile: ${e instanceof Error ? e.message : String(e)}` })
        return
      }
      draw()
    } else if (m.type === "call") {
      const f = fns[m.fn]
      if (!f) return post({ type: "idle" })
      try { f(...(m.args ?? [])) } catch (e) { errors.push(String(e)) }
      if (!queued) post({ type: "idle" })
    }
  })
}

// A page without an origin may be unable to start a worker: then it runs the program itself.
export function relayMain(code: string) {
  const parentPost = (m: unknown) => parent.postMessage(m, "*")
  let toWorker: (m: ToSandbox) => void
  let kill = () => {}
  let timer = 0
  const answered = () => { clearTimeout(timer); timer = 0 }
  const fromWorker = (m: { type?: unknown }) => { answered(); if (m.type !== "idle") parentPost(m) }
  try {
    const url = URL.createObjectURL(new Blob([`(${code})({post:(m)=>postMessage(m),listen:(f)=>addEventListener("message",(e)=>f(e.data))})`], { type: "text/javascript" }))
    const w = new Worker(url)
    w.onmessage = (e) => fromWorker(e.data)
    w.onerror = (e) => { e.preventDefault(); parentPost({ g: 1, type: "error", message: e.message || "it stopped" }) }
    toWorker = (m) => w.postMessage(m)
    kill = () => w.terminate()
  } catch {
    let listener: ((m: ToSandbox) => void) | null = null
    // eslint-disable-next-line no-new-func
    new Function("io", `(${code})(io)`)({ post: (m: { type?: unknown }) => setTimeout(() => fromWorker(m)), listen: (f: typeof listener) => { listener = f } })
    toWorker = (m) => setTimeout(() => listener?.(m))
  }
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.g !== 1) return
    toWorker(e.data)
    if (!timer) timer = window.setTimeout(() => { kill(); parentPost({ g: 1, type: "error", message: "It stopped answering, so it was stopped." }) }, 4000)
  })
  parentPost({ g: 1, type: "ready" })
}

const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:"
let doc = ""
export const sandboxDoc = () => (doc ||= `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>(${relayMain.toString()})(${JSON.stringify(workerMain.toString())})</script>`)
