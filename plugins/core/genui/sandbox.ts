// Where a DIL program runs: a hidden iframe with no origin or network, running it in a worker it stops if it hangs. The
// app gets back a tree of known components, never markup. Both functions go as source: nothing outside is in scope.
import type { Node } from "./dil.ts"

export type Tree = { t: "md"; s: string; slots?: Tree[] } | { t: "el"; n: string; p: Record<string, unknown>; k: Tree[] } | { t: "app"; p: Record<string, unknown>; html: string }
/** What the sandbox sends the app. */
export type FromSandbox =
  | { g: 1; type: "tree"; tree: Tree[]; errors: string[] }
  | { g: 1; type: "state"; state: Record<string, unknown> }
  | { g: 1; type: "action"; name: string; args: unknown[] }
  | { g: 1; type: "error"; message: string }
  | { g: 1; type: "ready" }
/** What the app sends it: a program to run (its saved values by name), a handler to call, or fresh saved values. */
export type ToSandbox =
  | { g: 1; type: "run"; nodes: Node[]; names: string[]; state: Record<string, unknown>; bindings?: Record<string, unknown> }
  | { g: 1; type: "call"; fn: number; args: unknown[] }

/** The program's side (in the worker): compile the tree to JS once, render it with hooks, send what it drew. */
export function workerMain(io: { post: (m: unknown) => void; listen: (f: (m: Record<string, unknown>) => void) => void }) {
  type N = Record<string, unknown> & { t: string }
  // No reaching out: the CSP already blocks the network, and these go too.
  for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel"]) {
    try { Object.defineProperty(globalThis, k, { value: undefined, configurable: false, writable: false }) } catch { /* not there */ }
  }
  const post = (m: Record<string, unknown>) => io.post({ g: 1, ...m })
  let render: (() => unknown[]) | null = null
  let names: string[] = []
  let saved: Record<string, unknown> = {}
  let slots: { v?: unknown; deps?: unknown[]; cleanup?: unknown }[] = []
  let effects: (() => void)[] = []
  let at = 0
  let fns: ((...a: unknown[]) => unknown)[] = []
  let errors: string[] = []
  let queued = false
  let rendering = false
  let stateDirty = false

  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const schedule = () => { if (!queued && !rendering) { queued = true; Promise.resolve().then(draw) } }
  const DIL = {
    useState(init: unknown) {
      const k = at++
      if (!slots[k]) {
        const name = names[k]
        slots[k] = { v: name !== undefined && Object.hasOwn(saved, name) ? saved[name] : typeof init === "function" ? (init as () => unknown)() : init }
      }
      const s = slots[k]
      const set = (v: unknown) => {
        const next = typeof v === "function" ? (v as (x: unknown) => unknown)(s.v) : v
        if (Object.is(next, s.v)) return
        s.v = next
        stateDirty = true
        schedule()
      }
      return [s.v, set]
    },
    useReducer(reducer: (s: unknown, a: unknown) => unknown, init: unknown) {
      const [v, set] = DIL.useState(init) as [unknown, (v: unknown) => void]
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
    useEffect(fn: () => unknown, deps?: unknown[]) {
      const k = at++
      const s = slots[k]
      if (s && deps && same(s.deps, deps)) return
      const prev = s?.cleanup
      slots[k] = { deps }
      effects.push(() => {
        if (typeof prev === "function") try { prev() } catch { /* its own */ }
        try { slots[k].cleanup = fn() } catch (e) { errors.push(String(e)) }
      })
    },
  }
  const GenUI = new Proxy({}, { get: (_, name) => (...args: unknown[]) => { post({ type: "action", name: String(name), args: clone(args) }) } })
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
  // A value in Markdown is text: its marks don't format.
  const escape = (s: string) => s.replace(/([\\`*_{}[\]<>()#+!|~$])/g, "\\$1").replace(/^(\s*)(\d+)\./gm, "$1$2\\.").replace(/^(\s*)-/gm, "$1\\-")
  // An element inside the text is a slot (its token in the text), drawn in its place by the app.
  const md = (parts: unknown[]) => {
    const slots: unknown[] = []
    const s = parts.map((p) => (typeof p === "string" ? p : (p as { el?: unknown }).el ? `\u2063${slots.push((p as { el: unknown }).el) - 1}\u2063` : escape(text((p as { v: unknown }).v)))).join("")
    return slots.length ? { t: "md", s, slots } : { t: "md", s }
  }
  // (images ChatGPT found are by the order they're drawn: each AsyncImage gets its number)
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
  const props = (ps: { name?: string; str?: string; e?: string; spread?: string }[]) =>
    `{${ps.map((p) => (p.spread !== undefined ? `...${expr(p.spread)}` : `${J(p.name)}:${p.str !== undefined ? J(p.str) : expr(p.e ?? "true")}`)).join(",")}}`
  const gen = (ns: N[]): string => `(()=>{const __k=[];${ns.map(one).join("\n")}\nreturn __k})()`
  const one = (n: N): string => {
    if (n.t === "md") return `__k.push(__md([${(n.parts as unknown[]).map((p) => (typeof p === "string" ? J(p) : (p as { el?: N }).el ? `{el:${gen([(p as { el: N }).el])}[0]}` : `{v:${expr((p as { e: string }).e)}}`)).join(",")}]));`
    if (n.t === "body") return `${n.js as string}\n;`
    if (n.t === "el") return `__k.push(__h(${J(n.name)},${props(n.props as [])},${gen(n.kids as N[])}));`
    if (n.t === "app") return `__k.push(__app(${props(n.props as [])},${J(n.html)}));`
    if (n.t === "each") return `__k.push(...__each(${expr(n.list as string)},(${n.as as string},${(n.index as string) ?? "__i"})=>${gen(n.kids as N[])}));`
    if (n.t === "if") {
      const bs = n.branches as { test: string | null; kids: N[] }[]
      return bs.map((b, i) => `${i ? "else " : ""}${b.test !== null ? `if (${expr(b.test)}) ` : ""}{__k.push(...${gen(b.kids)})}`).join("\n")
    }
    return ""
  }

  // Functions out of what it drew, into ids the app calls back with.
  const out = (v: unknown, depth = 0): unknown => {
    if (typeof v === "function") { fns.push(v as never); return { $fn: fns.length - 1 } }
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
      at = 0; errors = []; effects = []; fns = []; images = 0; maps = 0
      rendering = true
      let tree: unknown[] = []
      try { tree = render() } catch (e) { rendering = false; post({ type: "error", message: e instanceof Error ? e.message : String(e) }); return }
      rendering = false
      const ran = effects
      effects = []
      ran.forEach((f) => f())
      // An effect that set state draws again before anything shows, as React would.
      if (queued) { queued = false; continue }
      post({ type: "tree", tree: out(tree), errors: errors.slice(0, 20) })
      if (stateDirty) {
        stateDirty = false
        const state: Record<string, unknown> = {}
        names.forEach((name, k) => { const v = slots[k]?.v; if (k < slots.length && /^[\w$]+$/.test(name)) { const c = clone(v); if (c !== null || v === null) state[name] = c } })
        post({ type: "state", state })
      }
      return
    }
    post({ type: "error", message: "it kept redrawing itself" })
  }

  io.listen((m) => {
    if (m.type === "run") {
      names = (m.names as string[]) ?? []
      saved = (m.state as Record<string, unknown>) ?? {}
      slots = []
      // What ChatGPT filled in by name (turn0product2), in scope as it was there.
      const bound = Object.entries((m.bindings as Record<string, unknown>) ?? {}).filter(([k]) => /^[A-Za-z_$][\w$]*$/.test(k))
      try {
        // eslint-disable-next-line no-new-func
        const f = new Function("DIL", "React", "GenUI", "__x", "__md", "__h", "__app", "__each", ...bound.map(([k]) => k), `"use strict";\nreturn ${gen(m.nodes as N[])}`)
        render = () => f(DIL, DIL, GenUI, x, md, h, app, each, ...bound.map(([, v]) => v)) as unknown[]
      } catch (e) {
        render = null
        post({ type: "error", message: `It doesn't compile: ${e instanceof Error ? e.message : String(e)}` })
        return
      }
      draw()
    } else if (m.type === "call") {
      const f = fns[m.fn as number]
      if (!f) return post({ type: "idle" })
      try { f(...((m.args as unknown[]) ?? [])) } catch (e) { errors.push(String(e)) }
      if (!queued) post({ type: "idle" })
    }
  })
}

/** The iframe's side: starts the worker (or, where a page without an origin can't, runs the program itself), passes
 *  messages both ways, and stops a program that doesn't answer within a few seconds. */
export function relayMain(code: string) {
  const parentPost = (m: unknown) => parent.postMessage(m, "*")
  let toWorker: (m: unknown) => void
  let kill = () => {}
  let timer = 0
  const answered = () => { clearTimeout(timer); timer = 0 }
  const fromWorker = (m: Record<string, unknown>) => { answered(); if (m.type !== "idle") parentPost(m) }
  try {
    const url = URL.createObjectURL(new Blob([`(${code})({post:(m)=>postMessage(m),listen:(f)=>addEventListener("message",(e)=>f(e.data))})`], { type: "text/javascript" }))
    const w = new Worker(url)
    w.onmessage = (e) => fromWorker(e.data)
    w.onerror = (e) => { e.preventDefault(); parentPost({ g: 1, type: "error", message: e.message || "it stopped" }) }
    toWorker = (m) => w.postMessage(m)
    kill = () => w.terminate()
  } catch {
    let listener: ((m: Record<string, unknown>) => void) | null = null
    // eslint-disable-next-line no-new-func
    new Function("io", `(${code})(io)`)({ post: (m: Record<string, unknown>) => setTimeout(() => fromWorker(m)), listen: (f: typeof listener) => { listener = f } })
    toWorker = (m) => setTimeout(() => listener?.(m as Record<string, unknown>))
  }
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.g !== 1) return
    toWorker(e.data)
    if (!timer) timer = setTimeout(() => { kill(); parentPost({ g: 1, type: "error", message: "It stopped answering, so it was stopped." }) }, 4000) as unknown as number
  })
  parentPost({ g: 1, type: "ready" })
}

const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:"
let doc = ""
/** The sandbox iframe's page. */
export const sandboxDoc = () => (doc ||= `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>(${relayMain.toString()})(${JSON.stringify(workerMain.toString())})</script>`)
