// claude.ai's artifact runtime, so an artifact saved from Claude runs here as is: window.claude.use() (sample, db, artifact,
// user, downloads, permissions; else null), complete() and window.storage. Injected as source: no imports or outer names.

type Doc = Record<string, unknown>
export type DbQuery = { coll: string; where: [string, string, unknown][]; order: [string, "asc" | "desc"] | null; limit: number | null }

/** The documents of `q.coll` (direct children only) that match its filters, in its order, limited: their paths. */
export function queryDocs(docs: Map<string, Doc>, q: DbQuery): string[] {
  const depth = q.coll.split("/").length + 1
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const cmp = (a: any, b: any) => {
    const ta = typeof a, tb = typeof b
    if (ta !== tb) return ta < tb ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  }
  const test = (v: any, op: string, x: any) => {
    if (op === "==") return eq(v, x)
    if (op === "!=") return v !== undefined && !eq(v, x)
    if (op === "in") return Array.isArray(x) && x.some((y) => eq(v, y))
    if (op === "not-in") return v !== undefined && Array.isArray(x) && !x.some((y) => eq(v, y))
    if (op === "array-contains") return Array.isArray(v) && v.some((y) => eq(y, x))
    if (v === undefined || v === null || typeof v !== typeof x) return false
    const c = cmp(v, x)
    return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === ">=" ? c >= 0 : false
  }
  let out = [...docs.keys()].filter((p) => p.startsWith(q.coll + "/") && p.split("/").length === depth)
    .filter((p) => q.where.every(([f, op, x]) => test(docs.get(p)![f], op, x)))
    .sort((a, b) => (a < b ? -1 : 1))
  if (q.order) {
    const [f, dir] = q.order
    out = out.map((p, i) => ({ p, i, v: docs.get(p)![f] })).sort((a, b) => {
      const ma = a.v === undefined, mb = b.v === undefined
      if (ma || mb) return ma === mb ? a.i - b.i : ma ? 1 : -1
      return (dir === "desc" ? -cmp(a.v, b.v) : cmp(a.v, b.v)) || a.i - b.i
    }).map((x) => x.p)
  }
  return q.limit ? out.slice(0, q.limit) : out
}

/** A reply read as one JSON value: the whole of it, else one Markdown fence's body, else from the first { or [ to the
 *  last } or ]. undefined when none parses. */
export function parseReply(text: string): unknown {
  const tryParse = (s: string) => { try { return { v: JSON.parse(s) } } catch { return null } }
  const whole = tryParse(text.trim())
  if (whole) return whole.v
  const fence = /```[a-z]*\s*\n([\s\S]*?)\n?```/i.exec(text)
  const inFence = fence && tryParse(fence[1].trim())
  if (inFence) return inFence.v
  const a = text.search(/[{[]/), b = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"))
  const mid = a >= 0 && b > a ? tryParse(text.slice(a, b + 1)) : null
  return mid ? mid.v : undefined
}

type Io = {
  /** Ask the app; `onEvent` hears what it sends before the answer (a sample's text). */
  ask: (op: string, args: Record<string, unknown>, onEvent?: (x: any) => void) => Promise<any> & { id: number }
  post: (m: Record<string, unknown>) => void
  /** fn(data) for each message of `type` the app sends this page. */
  listen: (type: string, fn: (d: any) => void) => void
}
type RuntimeCfg = { framed: boolean; outside: boolean; path: string; title: () => string; version: number
  data: { db: Record<string, Doc>; storage: { shared: Record<string, string>; personal: Record<string, string> } }
  sample: boolean; sampleAllowed: boolean; name: string }

/** window.claude and window.storage, answered by the app (Frame.tsx) through `io`. */
export function claudeRuntime(cfg: RuntimeCfg, io: Io, queryDocs: (docs: Map<string, Doc>, q: DbQuery) => string[], parseReply: (t: string) => unknown) {
  const w = window as any
  const fail = (code: string, message: string, more: Record<string, unknown> = {}) => Promise.reject({ code, message, ...more })
  const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype
  const live = cfg.framed && !cfg.outside
  const later = (f: () => void) => setTimeout(f, 0)

  // ---------- sample (and the older complete())
  const TIERS = ["default", "complex", "quick"]
  const SYSTEM = "You answer a request from an interactive web page (an artifact) the user is viewing. You have no tools " +
    "and can't browse or remember earlier calls. Reply with exactly what the request asks for."
  let consent: "granted" | "prompt" | "denied" = cfg.sampleAllowed ? "granted" : "prompt"
  const cache = new Map<string, { at: number; gc: number; text: string; truncated: boolean; tier: string; model?: string }>()
  const promptOf = (input: unknown): string | null => {
    if (typeof input === "string") return input.trim() ? input : null
    if (!Array.isArray(input) || !input.length) return null
    const turns = input.map((t) => (plain(t) && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content ? t : null))
    if (turns.some((t) => !t) || turns[0]!.role !== "user" || turns[turns.length - 1]!.role !== "user") return null
    if (turns.length === 1) return turns[0]!.content as string
    return "The page keeps this conversation (its assistant turns are what it says you wrote earlier). Reply to the last user turn.\n\n" +
      turns.map((t) => `[${t!.role}]\n${t!.content}`).join("\n\n")
  }
  const askConsent = async () => {
    if (consent === "prompt") consent = (await io.ask("consent", { title: cfg.title() }).catch(() => false)) ? "granted" : "denied"
    return consent === "granted"
  }
  function call(verb: "sample" | "json", input: unknown, options: unknown = {}): Promise<any> {
    if (!plain(options)) return fail("invalid_request", "options must be a plain object (pass {signal: ctl.signal}, {onText})")
    const o = options as any
    const prompt = promptOf(input)
    if (prompt === null) return fail("invalid_request", "input is a non-empty prompt, or turns starting and ending on a user turn")
    if (new TextEncoder().encode(prompt).length > 262144) return fail("prompt_too_large", "input is over 256 KiB")
    if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) return fail("invalid_request", "signal must be an AbortSignal (ctl.signal, not the controller)")
    if (o.onText !== undefined && typeof o.onText !== "function") return fail("invalid_request", "onText must be a function")
    if (o.modelTier !== undefined && !TIERS.includes(o.modelTier)) return fail("invalid_request", `unknown modelTier '${o.modelTier}'`)
    if (o.images !== undefined && o.images !== null) return fail("images_unavailable", "this view can't send images")
    if (Array.isArray(o.tools) && o.tools.length) return fail("tools_unavailable", "this view can't run page tools")
    const c = o.cache
    if (!(c === undefined || typeof c === "boolean" || (plain(c) && (c.gcTime === undefined || (typeof c.gcTime === "number" && c.gcTime > 0)))))
      return fail("invalid_request", "cache is true, false or {gcTime, refresh}")
    const tier = o.modelTier ?? "default"
    const gc = c === false ? 0 : Math.min(plain(c) && c.gcTime ? Number(c.gcTime) : 300000, 86400000)
    const key = JSON.stringify([verb, prompt, tier, o.model ?? null, o.effort ?? null])
    const signal: AbortSignal | undefined = o.signal
    return new Promise((resolve, reject) => {
      let text = "", over = false
      const settle = (f: () => void) => { if (!over) { over = true; f() } }
      const shown = (delta: string) => {
        if (over || !delta || signal?.aborted) return
        text += delta
        try { o.onText?.({ text, delta }) } catch (e) { console.error(e) }
      }
      const finish = (r: { text: string; truncated: boolean; tier: string; model?: string }) => {
        if (verb === "json") {
          const v = r.truncated ? undefined : parseReply(r.text)
          return settle(() => (v === undefined ? reject({ code: "invalid_json", message: r.truncated ? "the answer was cut short" : "no JSON value in the reply", text: r.text }) : resolve(v)))
        }
        settle(() => resolve({ text: r.text, truncated: r.truncated, modelTierApplied: r.tier, ...(r.model ? { modelApplied: r.model } : {}) }))
      }
      queueMicrotask(async () => {
        if (signal?.aborted) return settle(() => reject({ code: "cancelled", message: "the signal was aborted" }))
        if (!live || !cfg.sample) return settle(() => reject({ code: "sampling_disabled", message: "Claude isn't available here" }))
        const hit = cache.get(key)
        if (gc && hit && !(plain(c) && c.refresh) && Date.now() - hit.at < Math.min(gc, hit.gc)) {
          return later(() => { shown(hit.text); if (hit.text === text) finish(hit) })
        }
        if (!(await askConsent())) return settle(() => reject({ code: "not_granted", message: "the user didn't allow this page to ask Claude" }))
        if (signal?.aborted) return settle(() => reject({ code: "cancelled", message: "the signal was aborted" }))
        const run = io.ask("sample", { prompt, tier, model: o.model, effort: o.effort,
          system: verb === "json" ? SYSTEM + " Your reply is parsed by the page as JSON: reply with only the JSON value." : SYSTEM }, (e) => shown(e.delta))
        const abort = () => { io.post({ type: "abort", id: run.id }); settle(() => reject({ code: "cancelled", message: "the signal was aborted", ...(text ? { text } : {}) })) }
        signal?.addEventListener("abort", abort, { once: true })
        run.then((r: any) => {
          signal?.removeEventListener("abort", abort)
          if (r.text !== text) shown(r.text.startsWith(text) ? r.text.slice(text.length) : r.text)
          const got = { text: r.text, truncated: !!r.truncated, tier, model: r.model }
          if (gc && verb === "sample") cache.set(key, { ...got, at: Date.now(), gc })
          if (gc && verb === "json" && parseReply(r.text) !== undefined && !r.truncated) cache.set(key, { ...got, at: Date.now(), gc })
          finish(got)
        }, (e: any) => {
          signal?.removeEventListener("abort", abort)
          if (e?.code === "not_granted") consent = "denied"
          settle(() => reject({ code: e?.code ?? "upstream_error", message: e?.message ?? String(e), ...(text ? { text } : {}) }))
        })
      })
    })
  }
  const sample = Object.assign((input: unknown, options?: unknown) => call("sample", input, options), {
    json: (input: unknown, options?: unknown) => call("json", input, options),
    limits: () => Promise.resolve({ maxPromptBytes: 262144 }),
  })

  // ---------- db: the documents kept in the sidecar, mirrored here; writes go through the app, other views' come back
  const docs = new Map<string, Doc>(Object.entries(cfg.data.db))
  const SEG = /^[A-Za-z0-9_\-.~:@+]+$/
  const check = (p: unknown, even: boolean) => {
    if (typeof p !== "string") throw new TypeError(`a path is a string (got ${typeof p}): did you await user.id()?`)
    const s = p.split("/")
    if (new TextEncoder().encode(p).length > 1000 || s.length > 16) throw new TypeError(`path '${p}' is over 1000 bytes or 16 segments`)
    for (const x of s) if (!SEG.test(x) || x === "." || x === ".." || new TextEncoder().encode(x).length > 200) throw new TypeError(`path '${p}': segment '${x}' isn't letters, digits and _ - . ~ : @ +`)
    if ((s.length % 2 === 0) !== even) throw new TypeError(`path '${p}' has ${s.length} segments: a document has an even number, a collection an odd one`)
    return p
  }
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false })
  const snaps = new Map<string, { body: Doc | undefined; snap: any }>()
  const snapOf = (p: string) => {
    const body = docs.get(p), hit = snaps.get(p)
    if (hit && hit.body === body) return hit.snap
    const id = p.slice(p.lastIndexOf("/") + 1)
    const frozen = body && deepFreeze(JSON.parse(JSON.stringify(body)))
    const snap = Object.freeze({ id, exists: !!body, data: () => frozen, metadata: META })
    snaps.set(p, { body, snap })
    return snap
  }
  function deepFreeze(x: any) { if (x && typeof x === "object") { Object.values(x).forEach(deepFreeze); Object.freeze(x) } return x }
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((f) => { try { f() } catch (e) { console.error(e) } })
  const dbErr = (code: string, message: string) => ({ code, message })
  const write = (path: string, body: Doc | null) => {
    if (!live) return fail("not_granted", "this view keeps no data")
    if (body) {
      let text: string
      try { text = JSON.stringify(body) } catch { return fail("invalid_argument", "a document is plain JSON") }
      if (text.length > 262144) return fail("invalid_argument", "a document is at most 256 KiB")
      docs.set(path, JSON.parse(text))
    } else docs.delete(path)
    changed()
    return io.ask("db", { writes: [{ path, data: body ? docs.get(path) : null }] }).then(() => undefined, (e: any) => Promise.reject(dbErr("unavailable", e?.message ?? "couldn't save")))
  }
  const merge = (a: any, b: any): any => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = plain(v) && plain(a?.[k]) ? merge(a[k], v) : v
    return out
  }
  let subs = 0
  const subscribe = (deliver: () => boolean, error?: (e: unknown) => void) => {
    if (subs >= 64) { later(() => error ? error(dbErr("resource_exhausted", "at most 64 subscriptions")) : reportError(new Error("db: at most 64 subscriptions"))); return () => {} }
    subs++
    let on = true
    const f = () => { if (on) deliver() }
    listeners.add(f)
    later(f)
    return () => { if (on) { on = false; subs--; listeners.delete(f) } }
  }
  const docRef = (path: string): any => {
    check(path, true)
    return Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1), path,
      get: () => Promise.resolve(snapOf(path)),
      set: (data: unknown) => (plain(data) ? write(path, data) : fail("invalid_argument", "set() takes an object")),
      update: (data: unknown) => (!plain(data) ? fail("invalid_argument", "update() takes an object")
        : !docs.has(path) ? fail("invalid_argument", `no document at ${path} to update`) : write(path, merge(docs.get(path), data))),
      delete: () => write(path, null),
      // One user: the lease is always theirs.
      acquire: (opts: any) => {
        const ttl = Math.min(Math.max(Number(opts?.ttlMs) || 30000, 1000), 600000)
        const done = { acquired: true, version: Date.now(), expiresAt: new Date(Date.now() + ttl).toISOString(), holder: String(opts?.holder ?? "") }
        return plain(opts?.data) ? write(path, merge(docs.get(path) ?? {}, opts.data)).then(() => done) : Promise.resolve(done)
      },
      onSnapshot: (next: (s: unknown) => void, error?: (e: unknown) => void) => {
        let last: unknown = null
        return subscribe(() => { const s = snapOf(path); if (s === last) return false; last = s; next(s); return true }, error)
      },
      collection: (sub: string) => collRef(`${path}/${sub}`),
    })
  }
  const OPS = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains"]
  const query = (q: DbQuery): any => {
    const more = (x: Partial<DbQuery>) => query({ ...q, ...x })
    const run = () => queryDocs(docs, q).map(snapOf)
    const snapshot = (list: any[], before: any[] | null) => Object.freeze({
      docs: list, size: list.length, empty: !list.length, metadata: META,
      docChanges: () => {
        const prev = before ?? []
        const out: any[] = []
        prev.forEach((d, i) => { if (!list.some((x) => x.id === d.id)) out.push({ type: "removed", doc: d, oldIndex: i, newIndex: -1 }) })
        list.forEach((d, i) => {
          const j = prev.findIndex((x) => x.id === d.id)
          if (j < 0) out.push({ type: "added", doc: d, oldIndex: -1, newIndex: i })
          else if (prev[j] !== d || j !== i) out.push({ type: "modified", doc: d, oldIndex: j, newIndex: i })
        })
        return out
      },
    })
    return Object.freeze({
      where: (field: string, op: string, value: unknown) => {
        if (!OPS.includes(op) || q.where.length >= 10) throw new TypeError(`where(): '${op}' isn't an operator, or over 10 filters`)
        return more({ where: [...q.where, [field, op, value]] })
      },
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => more({ order: [field, dir === "desc" ? "desc" : "asc"] }),
      limit: (n: number) => more({ limit: Math.max(1, Math.min(1000, Math.floor(n))) }),
      get: () => Promise.resolve(snapshot(run(), null)),
      onSnapshot: (next: (s: unknown) => void, error?: (e: unknown) => void) => {
        let last: any[] | null = null
        return subscribe(() => {
          const now = run()
          if (last && now.length === last.length && now.every((d, i) => d === last![i])) return false
          const s = snapshot(now, last)
          last = now
          next(s)
          return true
        }, error)
      },
    })
  }
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("")
  const collRef = (path: string): any => {
    check(path, false)
    const q = query({ coll: path, where: [], order: null, limit: null })
    return Object.freeze({ ...q, path,
      doc: (id?: string) => docRef(`${path}/${id ?? newId()}`),
      add: (data: unknown) => { const r = docRef(`${path}/${newId()}`); return r.set(data).then(() => r) },
    })
  }
  const db = Object.freeze({ doc: docRef, collection: collRef })
  io.listen("db", (d) => {
    for (const x of d.writes ?? []) { if (x.data) docs.set(x.path, x.data); else docs.delete(x.path) }
    changed()
  })

  // ---------- user: the viewer is the vault's owner
  const ME = "u_owner"
  const name = cfg.name || "You"
  const color = "#d97757"
  const avatar = (n: string) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="41" font-family="system-ui" font-size="26" fill="#fff" text-anchor="middle">${(n[0] || "?").toUpperCase().replace(/[<&]/g, "")}</text></svg>`)
  const profile = (id: string) => Object.freeze(id === ME ? { id, name, avatarUrl: avatar(name), color, email: null, isMe: true, guest: false }
    : { id, name: "", avatarUrl: avatar("?"), color: "#8e8e93", email: null, isMe: false, guest: false })
  const user = Object.freeze({
    isOwner: () => Promise.resolve(true), canEdit: () => Promise.resolve(true), can: () => Promise.resolve(true),
    id: () => Promise.resolve(ME), name: () => Promise.resolve(name), avatarUrl: () => Promise.resolve(avatar(name)), email: () => Promise.resolve(null),
    me: () => Promise.resolve(Object.freeze({ id: ME, name, avatarUrl: avatar(name), color, email: null, isOwner: true, canEdit: true })),
    profiles: (ids: readonly string[] | string) => Promise.resolve(Object.fromEntries([...new Set(typeof ids === "string" ? [ids] : [...ids])].map((id) => [id, profile(String(id))]))),
    search: (q: string) => Promise.resolve(!q || name.toLowerCase().includes(String(q).toLowerCase()) ? [profile(ME)] : []),
  })

  // ---------- artifact (self): publish rewrites the .html file; the app reloads every view of it
  const artifact = Object.freeze({
    publish: (x: unknown) => {
      if (!live) return fail("not_granted", "this view can't save the page")
      if (typeof x !== "string") return fail("capability_disabled", "only a whole page can be published here (publish(html))")
      if (!/^\s*<!doctype html/i.test(x)) return fail("invalid_content", "a page starts with <!doctype html>")
      if (x.length > 16 << 20) return fail("too_large", "the page is over 16 MB")
      return io.ask("publish", { html: x, version: cfg.version }).then((r: any) => ({ version: String(r.version) }),
        (e: any) => Promise.reject({ code: e?.code ?? "upstream_error", message: e?.message ?? "couldn't save", ...(e?.live ? { live: e.live } : {}) }))
    },
    edit: () => fail("invalid_content", "this artifact isn't a live doc"),
    sync: () => fail("invalid_content", "this artifact isn't a live doc"),
    metadata: (refs: readonly string[]) => Promise.resolve(Object.fromEntries([...refs].map((r) => {
      const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(r))?.[1].toLowerCase() ?? ""
      return [r, { id, title: "", type: null }]
    }))),
  })

  // ---------- downloads: the sandbox may download
  const EXTS = "gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip".split(" ")
  const downloads = Object.freeze({
    save: (r: any) => {
      if (!plain(r) || typeof r.filename !== "string" || r.filename.length > 512 || r.data === undefined || r.data === null) return fail("bad_request", "save({filename, data})")
      const file = r.filename.replace(/[\u0000-\u001f\u200b-\u200f\u2028-\u202f\ufeff]/g, "").replace(/\s+/g, " ").replace(/[/\\]/g, "-").trim()
      const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1].toLowerCase()
      if (!ext || !EXTS.includes(ext)) return fail("rejected_extension", `.${ext ?? ""} files can't be saved`)
      const blob = r.data instanceof Blob ? r.data : new Blob([r.data as BlobPart])
      if (!blob.size) return fail("bad_request", "data is empty")
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = file
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60000)
      return Promise.resolve({ status: "saved" })
    },
  })

  // ---------- permissions: what's served is granted, but asking Claude, which asks once
  const served: Record<string, unknown> = live ? { ...(cfg.sample ? { sample } : {}), db, artifact, self: artifact, user, downloads } : {}
  const stateOf = (n: string) => (n === "permissions" || !(n in served) ? "unavailable" : n === "sample" ? consent : "granted")
  const permissions = Object.freeze({
    state: (n?: string) => Promise.resolve(n === undefined ? Object.fromEntries(Object.keys(served).map((k) => [k, stateOf(k)])) : stateOf(String(n))),
    request: async (names?: readonly string[]) => {
      const list = names ? [...names].map(String) : Object.keys(served)
      if (list.includes("sample") && "sample" in served) await askConsent()
      return Object.fromEntries(list.filter((k) => names || stateOf(k) !== "unavailable").map((k) => [k, stateOf(k)]))
    },
    manage: () => fail("unavailable", "there's no permissions panel here"),
  })
  if (live) served.permissions = permissions

  const memo = new Map<string, Promise<unknown>>()
  const use = (n: string) => {
    if (!(n in served)) return Promise.resolve(null)
    if (!memo.has(n)) memo.set(n, new Promise((r) => later(() => r(served[n]))))
    return memo.get(n)!
  }
  // The older chat artifacts' flat API: complete(prompt) -> text.
  const complete = (prompt: unknown) => call("sample", typeof prompt === "string" ? prompt : String(prompt ?? ""))
    .then((r: any) => r.text, (e: any) => Promise.reject(new Error(e?.message ?? String(e))))
  try { Object.defineProperty(w, "claude", { value: Object.freeze({ use, complete }), configurable: true }) } catch { /* the page's own */ }

  // ---------- window.storage (older artifacts): strings by key, the user's own or shared, in the same sidecar
  const kept = { true: new Map(Object.entries(cfg.data.storage.shared)), false: new Map(Object.entries(cfg.data.storage.personal)) }
  const save = (shared: boolean, key: string, value: string | null) =>
    live ? io.ask("storage", { writes: [{ shared, key, value }] }).catch((e: any) => Promise.reject(new Error(e?.message ?? "couldn't save"))) : Promise.resolve()
  const keyOf = (k: unknown) => { if (typeof k !== "string" || !k) throw new Error("a key is a non-empty string"); return k }
  const storage = Object.freeze({
    get: async (key: string, shared = false) => {
      const k = keyOf(key), m = kept[`${!!shared}` as "true"]
      return m.has(k) ? { key: k, value: m.get(k)!, shared: !!shared } : null
    },
    set: async (key: string, value: unknown, shared = false) => {
      const k = keyOf(key), v = typeof value === "string" ? value : JSON.stringify(value)
      kept[`${!!shared}` as "true"].set(k, v)
      await save(!!shared, k, v)
      return { key: k, value: v, shared: !!shared }
    },
    delete: async (key: string, shared = false) => {
      const k = keyOf(key)
      kept[`${!!shared}` as "true"].delete(k)
      await save(!!shared, k, null)
      return { key: k, deleted: true, shared: !!shared }
    },
    list: async (prefix = "", shared = false) => ({ keys: [...kept[`${!!shared}` as "true"].keys()].filter((k) => k.startsWith(prefix ?? "")).sort(), prefix: prefix ?? "", shared: !!shared }),
  })
  io.listen("storage", (d) => {
    for (const x of d.writes ?? []) { const m = kept[`${!!x.shared}` as "true"]; if (x.value === null) m.delete(x.key); else m.set(x.key, x.value) }
  })
  try { Object.defineProperty(w, "storage", { value: storage, configurable: true }) } catch { /* the page's own */ }
}
