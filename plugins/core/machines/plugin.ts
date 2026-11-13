import crypto from "node:crypto"
import { z } from "zod"
import os from "node:os"
import { API_VERSION, APP_VERSION, bullets, HTTPError, inDesktop, LOADED, localDate, logger, noDesktop, MACHINE_CLIENT, onTailnet, Plugin, replyWithin, reply, running, section, Text } from "../../../core/plugins.ts"
import { dialIn, type DialEntry, Entries } from "./dial.ts"
import { shareKept } from "./kept.ts"
import { alerts, duration, EVERY, KEEP_DAYS, machineNow, type Now, report, reportText, sample, SampleRow, watch, type Report, type Sample } from "./health.ts"
import type { Item } from "../../../core/vault.ts"

const Words = z.array(z.unknown()).catch([])
const Relayed = z.looseObject({ error: z.unknown().optional() }).catch({})

export const plugin = new Plugin(import.meta.url)
const log = logger("machines")

export type Machine = {
  id: string; label: string; url: string; online: boolean; self: boolean
  dial?: boolean; readOnly?: boolean; via?: string; home?: string
  host?: string; platform?: string; version?: string; commit?: string; plugins?: string[]; vault?: string; error?: string
  desktop?: boolean
  standalone?: boolean
  slow?: boolean
} & Partial<Now>

const INSTANCE = crypto.randomUUID()
const STANDALONE = process.env.VAULTITE_DESKTOP !== "1"
const HOST = os.hostname().replace(/\.local$/, "")
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/

export const slug = (s: string) => s.toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63)

function listed(): DialEntry[] {
  const raw = plugin.settings({}).machines
  const out: DialEntry[] = []
  for (const m of Entries.parse(raw)) {
    const id = String(m?.id ?? "").toLowerCase(), url = String(m?.url ?? "").replace(/\/+$/, "")
    const via = typeof m.via === "string" && ID.test(m.via) && m.via !== id ? m.via : undefined
    if (!ID.test(id) || (!via && !onTailnet(url)) || out.some((o) => o.id === id)) continue
    out.push({ id, label: String(m.label || id), url: via ? "" : url, ...(via ? { via } : {}) })
  }
  return out
}

function enabledPlugins() {
  const skip = plugin.vault.switchedOff()
  return LOADED.map((p) => p.id).filter((id) => !skip.has(id))
}

function vaultId(): string {
  let cur: Item | null
  try { cur = plugin.readSettings("vault") } catch { return "" }
  if (typeof cur?.id === "string" && cur.id) return cur.id
  if (!listed().length) return ""
  const id = crypto.randomUUID()
  plugin.saveSettings({ id }, "vault")
  return id
}

async function self() {
  return { instance: INSTANCE, host: HOST, platform: process.platform, version: APP_VERSION, api: API_VERSION,
    commit: (await running()).commit?.slice(0, 7) ?? "", plugins: enabledPlugins(), vault: vaultId(), desktop: inDesktop(), standalone: STANDALONE, ...machineNow(latest),
    dialed: Object.fromEntries(listed().filter((m) => m.via).map((m) => [m.id, dial.summary(m.id)])) }
}

const PORT = Number(process.env.PORT || 8793)
const LOOPBACK = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`)
const ownUrl = async () => String(await plugin.ask("machines:url", "")).replace(/\/+$/, "")
const knownOwn = new Set<string>()
const isOwn = (url: string, own: string) => LOOPBACK.test(url) || (!!own && url === own) || knownOwn.has(url)

const dial = dialIn(plugin, listed, selfId)

const said = <T extends z.ZodType>(t: T) => t.optional().catch(undefined)
const SIZE = z.number().nonnegative()
const DesktopAnswer = z.object({ error: z.unknown(), value: z.unknown() }).partial().catch({})

const SELF = z.object({
  instance: z.unknown().optional(), host: said(z.string()), platform: said(z.string()), version: said(z.string()), commit: said(z.string()),
  plugins: z.array(z.string()).catch([]), vault: said(z.string()), desktop: z.boolean().catch(false), standalone: z.boolean().catch(false),
  dialed: said(z.record(z.string(), z.looseObject({}))),
  cores: said(z.number().positive()), load: said(SIZE), memory: said(z.object({ total: SIZE, free: SIZE })), display: said(z.boolean()),
})
type Probed = { machine: Machine; dialed?: z.infer<typeof SELF>["dialed"] }
const answered = new Map<string, { at: number; probed: Probed }>()
const SLOW_GRACE_MS = 2 * 60_000

async function probeDirect(m: DialEntry, own: string): Promise<Probed> {
  if (isOwn(m.url, own)) {
    const s = await self()
    return { machine: { ...m, online: true, self: true, host: s.host, platform: s.platform, version: s.version, commit: s.commit || undefined, plugins: s.plugins,
      vault: s.vault || undefined, desktop: s.desktop, standalone: s.standalone, cores: s.cores, load: s.load, memory: s.memory, display: s.display } }
  }
  try {
    const r = await fetch(`${m.url}/api/machines/self`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { machine: { ...m, online: false, self: false, error: `answered ${r.status}` } }
    const { instance, dialed, ...s } = SELF.parse(await r.json())
    if (instance === INSTANCE) knownOwn.add(m.url)
    const probed: Probed = { machine: { ...m, online: true, self: instance === INSTANCE, ...s, commit: s.commit || undefined, vault: s.vault || undefined }, dialed }
    answered.set(m.url, { at: Date.now(), probed })
    return probed
  } catch (e) {
    const last = answered.get(m.url)
    if (e instanceof Error && e.name === "TimeoutError" && last && Date.now() - last.at < SLOW_GRACE_MS) return { ...last.probed, machine: { ...last.probed.machine, ...m, slow: true } }
    answered.delete(m.url)
    return { machine: { ...m, online: false, self: false, error: unreachable(e) } }
  }
}

function unreachable(e: unknown) {
  if (e instanceof Error && e.name === "TimeoutError") return "no answer"
  const cause = e instanceof Error ? e.cause : undefined
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "its name isn't found (DNS)"
  if (code === "ECONNREFUSED") return "refused (its server isn't running)"
  return "unreachable"
}

async function probe(m: DialEntry, own: string, direct = (e: DialEntry) => probeDirect(e, own)): Promise<Machine> {
  if (!m.via) return (await direct(m)).machine
  const offline = { ...m, online: false, self: false, dial: true, readOnly: true, plugins: [], error: "relay unavailable" }
  const via = listed().find((e) => e.id === m.via && !e.via)
  if (!via) return offline
  const relay = await direct(via)
  if (relay.machine.self) return { ...m, ...dial.summary(m.id) }
  if (!relay.machine.online) return offline
  const said = relay.dialed?.[m.id]
  if (said) return { ...m, ...said, online: said.online === true, self: false, dial: true, readOnly: true, plugins: [] }
  try {
    const r = await fetch(`${via.url}/api/machines/${m.id}/info`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error("relay offline")
    return { ...m, ...(await r.json()), self: false, dial: true, readOnly: true, plugins: [] }
  } catch { return offline }
}

async function machines(): Promise<Machine[]> {
  return plugin.memoStale(20, async function machines(key: string) {
    void key
    vaultId()
    const own = await ownUrl(), asked = new Map<string, Promise<Probed>>()
    const direct = (e: DialEntry) => { let p = asked.get(e.id); if (!p) asked.set(e.id, p = probeDirect(e, own)); return p }
    return Promise.all(listed().map((m) => probe(m, own, direct)))
  }, JSON.stringify(listed()))
}

async function selfId(): Promise<string | null> {
  const list = listed()
  if (!list.length) return null
  const own = await ownUrl()
  const hit = list.find((m) => !m.via && isOwn(m.url, own))
  if (hit) return hit.id
  return (await machines()).find((m) => m.self)?.id ?? null
}

async function machine(id: string) {
  const list = await machines(), key = id.trim().toLowerCase()
  return list.find((m) => m.id === id) ?? list.find((m) => m.id.toLowerCase() === key)
    ?? list.find((m) => m.label?.toLowerCase() === key) ?? null
}

shareKept(plugin, machines, vaultId)

plugin.provide("machines", machines)
plugin.provide("machines:machine", machine)
plugin.provide("machines:self", selfId)
plugin.provide("machines:vault", vaultId)
plugin.provide("machines:ids", () => listed().map((m) => m.id))
/** The machine that runs the jobs and writes what plugins generate: device sync's hub if one is set, else the first listed. */
plugin.provide("machines:writer", async () => {
  const hub = String(await plugin.ask<string | null>("sync:hub", null) ?? ""), ids = listed().filter((m) => !m.via).map((m) => m.id)
  return ids.includes(hub) ? hub : ids[0] ?? null
})

plugin.route("GET", "machines", () => machines())
plugin.route("GET", "machines/self", () => self())
plugin.route("GET", "machines/health", async (req) => {
  await plugin.ownerOnly(req, "This machine's processes")
  return health(req.query.since || "24h")
}, { lock: false })

async function browserThere(all: Machine[]) {
  const own = vaultId()
  return all.find((x) => !x.self && !x.via && x.online && x.desktop && x.standalone && (!own || x.vault === own)) ?? null
}
async function desktopThere(name: string, args: unknown[], waits = 0) {
  const own = vaultId(), all = await machines()
  const m = await browserThere(all)
  if (!m) {
    const others = all.filter((x) => !x.self && !x.via)
    const why = others.map((x) => `${x.label} ${!x.online ? `(${x.error ?? "offline"})` : own && x.vault !== own ? "(another vault)"
      : !x.standalone ? "(a laptop's app: only its own agents)" : "(no desktop app attached)"}`)
    throw new Error(`${noDesktop()}${why.length ? ` (${why.join(", ")})` : ""}`)
  }
  let r: Response
  try {
    r = await fetch(`${m.url}/api/machines/desktop`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify({ name, args, waits }), signal: AbortSignal.timeout(replyWithin(waits) + 10_000) })
  } catch { throw new Error(`${m.label}'s desktop app doesn't answer`) }
  const answer = DesktopAnswer.parse(await r.json().catch(() => ({})))
  if (!r.ok) throw new Error(`${String(answer.error || `${m.label} answered ${r.status}`)} (on ${m.label})`)
  return answer.value
}
/** What plugin.desktop does on a server with no desktop app attached. */
plugin.provide("machines:desktop", desktopThere)
/** The machine whose browser this server's agents use (its tabs' numbers are that browser's): this one, or null. */
plugin.provide("machines:browser", async () => (inDesktop() ? selfId() : (await browserThere(await machines()))?.id ?? null))

plugin.route("POST", "machines/desktop", async (req) => {
  await plugin.ownerOnly(req, "The desktop app's browser")
  if (!inDesktop()) throw new HTTPError(409, "no desktop app is attached to this machine's server")
  const name = String(req.body?.name ?? "")
  if (!/^agent:[a-z-]+$/.test(name)) throw new HTTPError(400, "only the browser's agent calls")
  const waits = Math.min(3600_000, Math.max(0, Number(req.body?.waits) || 0))
  try { return { value: (await plugin.desktopWaiting(waits, name, ...(Array.isArray(req.body.args) ? req.body.args : []))) ?? null } }
  catch (e) { throw new HTTPError(409, e instanceof Error ? e.message : String(e)) }
}, { lock: false })

const FS: Record<string, string> = { "fs/list": "ls", "fs/read": "read", "fs/recent": "recent" }

async function agentFs(id: string, rest: string, query: Record<string, string> = {}): Promise<unknown> {
  const m = listed().find((x) => x.id === id)
  if (!m?.via) throw new HTTPError(404, `no agent machine '${id}'`)
  if (rest !== "info" && !FS[rest]) throw new HTTPError(404, "This machine only lists folders and reads files")
  const via = listed().find((e) => e.id === m.via && !e.via)
  if (!via) throw new HTTPError(502, "The relay machine is missing")
  const own = await ownUrl()
  if (isOwn(via.url, own) || (await probe(via, own)).self) {
    if (rest === "info") return dial.summary(m.id)
    return dial.request(m.id, FS[rest], { path: query.path ?? "~", ...(query.max ? { max: Number(query.max) } : {}) })
  }
  const qs = new URLSearchParams(query).toString()
  let r: Response
  try { r = await fetch(`${via.url}/api/machines/${encodeURIComponent(m.id)}/${rest}${qs ? `?${qs}` : ""}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(20000) }) }
  catch { throw new HTTPError(502, `${via.label} doesn't answer`) }
  const answer = Relayed.parse(await r.json().catch(() => ({})))
  if (!r.ok) throw new HTTPError(r.status, String(answer.error || `${via.label} couldn't read ${m.label}'s files`))
  return answer
}
plugin.provide("machines:fs", agentFs)

plugin.route("GET", "machines/*/**", async (req) => {
  const id = req.arg(0), rest = req.arg(1)
  const m = listed().find((x) => x.id === id)
  if (!m) throw new HTTPError(404, `no machine '${id}' (the machines are in .vaultite/plugins/machines/data.json)`)
  if (m.via) {
    if (rest !== "info" && !FS[rest]) throw new HTTPError(404, "This machine only lists folders and reads files")
    await plugin.ownerOnly(req, "Reading an agent machine's files")
    return agentFs(id, rest, req.query)
  }
  await plugin.ownerOnly(req, "Another machine's API")
  const qs = new URLSearchParams(req.query).toString()
  let r: Response
  try {
    r = await fetch(`${m.url}/api/${rest.split("/").map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`,
      { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new HTTPError(502, `${m.label} doesn't answer`)
  }
  const type = r.headers.get("content-type") ?? "application/octet-stream"
  const body = Buffer.from(await r.arrayBuffer())
  if (r.status === 200) return new Text(body, type, { "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" })
  let err: unknown = { error: body.toString("utf8").slice(0, 500) }
  if (type.includes("json")) try { err = JSON.parse(body.toString("utf8")) } catch {}
  return reply(r.status, err)
}, { lock: false })

async function register() {
  const url = await ownUrl()
  if (/^https?:\/\//.test(url)) join(url)
}
function join(url: string) {
  let cur: Item | null
  try { cur = plugin.readSettings() } catch { return }
  const list = Entries.parse(cur?.machines)
  const added = Words.parse(cur?.added).map(String)
  const id = slug(HOST)
  if (!id) return
  const listed = list.some((m) => String(m?.url ?? "").replace(/\/+$/, "") === url || String(m?.id ?? "").toLowerCase() === id)
  if (added.includes(id)) return
  plugin.saveSettings({ ...(cur ?? {}), machines: listed ? list : [...list, { id, label: HOST, url }], added: [...added, id] })
  plugin.forget()
}
plugin.exports.join = join
const first = setTimeout(() => { if (plugin.loaded) void register() }, 5000)
const hourly = setInterval(() => { if (plugin.loaded) void register() }, 3600 * 1000)
first.unref?.(); hourly.unref?.()
plugin.onUnload(() => { clearTimeout(first); clearInterval(hourly) })

const healthLog = plugin.dayLog("health", SampleRow)
const watching = watch()
let latest: Sample | null = null
function health(span: string): Report {
  let since: number
  try { since = Date.now() - duration(span) } catch (e) { throw new HTTPError(400, e instanceof Error ? e.message : String(e)) }
  const days: string[] = []
  for (let t = since; t < Date.now() + 86400_000; t += 86400_000) days.push(localDate(t))
  return report([...new Set(days)].flatMap((d) => healthLog.read(d)).filter((s) => s.t >= since).sort((a, b) => a.t - b.t), since)
}
async function sampleHealth() {
  if (!plugin.loaded || plugin.isOff()) return
  const s = await sample()
  if (!s) return
  latest = s
  healthLog.append(s.t, [s])
  healthLog.prune(KEEP_DAYS)
  for (const a of alerts(watching, s, HOST))
    await plugin.ask("inbox:event", null, { source: "machines", kind: "error", key: `health-${HOST}-${a.key}`, title: a.title, body: a.body })
}
if (process.env.VAULTITE_TEST !== "1") {
  const sampler = setInterval(() => void sampleHealth().catch((e) => log.error("health sample", e)), EVERY)
  sampler.unref?.()
  plugin.onUnload(() => clearInterval(sampler))
}

plugin.op({
  id: "machines.health", cli: "machines health", mcp: "machine_health", kind: "read", owner: "This machine's processes",
  summary: "What has been hogging a machine and since when: load, memory pressure, swap, and processes that held high CPU or memory.",
  help: `Every server samples its machine once a minute (load, memory pressure, swap, the top processes by CPU and by
memory), kept a week on that machine. This lists what held a lot of CPU (50%+, 100 is one core) or memory (a tenth of
RAM) for 5+ samples, each with when it was first and last seen so. A process over 80% CPU for 10 min, or memory critical
as long, is also sent to the inbox, once in 6 hours.

  vau machines health
  vau machines health --since 6h
  vau machines health --machine studio --since 2d`,
  params: {
    since: { type: "string", default: "24h", description: "how far back: 30m, 6h, 7d" },
    machine: { type: "string", description: "another machine's id (Machines' list): its health, asked through this server" },
  },
  run: async ({ since, machine }, ctx) => {
    if (!machine) return health(since)
    const r = await ctx.api("GET", `machines/${encodeURIComponent(machine)}/machines/health?since=${encodeURIComponent(since)}`)
    return typeof r === "string" || Buffer.isBuffer(r) ? JSON.parse(String(r)) : r
  },
  text: (r: Report) => reportText(r),
})

plugin.block("machines", async () => {
  const ms = await machines()
  return section("Machines", bullets(ms.map((m) => `${m.label}${m.self ? " (this one)" : ""}: ${m.online
    ? ["online", m.host, m.version && `Vaultite ${m.version}${m.commit ? ` (${m.commit})` : ""}`].filter(Boolean).join(", ")
    : `offline (${m.error})`}${m.dial ? `, read-only files via ${m.via}` : `, ${m.url}`}`), "No machines yet: add them to .vaultite/plugins/machines/data.json."))
})

plugin.route("GET", "machines/enrollment", async (req) => {
  await plugin.ownerOnly(req, "Enrolling agent machines")
  return { pending: dial.pending() }
}, { lock: false })

plugin.op({
  id: "machines.approve", owner: "Enrolling an agent machine", kind: "write",
  summary: "Approve a read-only file agent using the enrollment code it shows.",
  help: "The VM generates its own key and shows an eight-digit code. Approve that code on the Vaultite server it dialed. Files then appear in Machines on every device sharing the vault.\n\n  vau machines.approve 12345678",
  args: ["code"], params: { code: { type: "string", required: true, description: "the file agent's eight-digit code" }, label: { type: "string", description: "the machine's display name" } },
  run: (p) => dial.approve(p.code, p.label),
})
plugin.op({
  id: "machines.revoke", owner: "Revoking an agent machine", kind: "write",
  summary: "Revoke a file agent's key and close its connection on this server.",
  help: "Run on the machine shown as its relay. The entry remains offline until enrolled again.\n\n  vau machines.revoke sandbox",
  args: ["id"], params: { id: { type: "string", required: true, description: "the agent machine's id" } },
  run: async (p) => {
    const m = listed().find((e) => e.id === p.id), via = listed().find((e) => e.id === m?.via && !e.via)
    if (via) {
      const own = await ownUrl()
      if (!isOwn(via.url, own) && !(await probe(via, own)).self) return relayWrite(via, "ops/machines.revoke", { id: p.id })
    }
    if (!m?.via) throw new HTTPError(404, "No such agent machine")
    return dial.revoke(p.id)
  },
})

async function relayWrite(via: DialEntry, route: string, body: Item) {
  let r: Response
  try { r = await fetch(`${via.url}/api/${route}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }) }
  catch { throw new HTTPError(502, `${via.label} doesn't answer`) }
  const answer = Relayed.parse(await r.json())
  if (!r.ok) throw new HTTPError(r.status, String(answer.error || "The relay refused the request"))
  return answer
}
plugin.route("POST", "machines/*/approve", async (req) => {
  await plugin.ownerOnly(req, "Enrolling agent machines")
  const via = listed().find((e) => e.id === req.arg(0) && !e.via)
  if (!via) throw new HTTPError(404, "No such relay server")
  const own = await ownUrl()
  if (isOwn(via.url, own) || (await probe(via, own)).self) return dial.approve(String(req.body.code ?? ""))
  return relayWrite(via, "ops/machines.approve", { code: String(req.body.code ?? "") })
}, { lock: false })

for (const [id, route, summary] of [
  ["machines.files", "list", "List a folder on a read-only agent machine."],
  ["machines.read", "read", "Read a regular file on a read-only agent machine (text or base64, at most 1 MB)."],
]) plugin.op({
  id, kind: "read", owner: "Reading an agent machine's files", summary,
  help: "The machine must be enrolled and online. Paths are on that machine; ~ is its home. Nothing is written or executed.\n\n  vau " + id + " sandbox --path ~",
  args: ["machine"], params: { machine: { type: "string", required: true, description: "the enrolled agent machine's id" }, path: { type: "string", description: "the VM path (default: its home folder)" } },
  run: (p, ctx) => ctx.api("GET", `machines/${encodeURIComponent(p.machine)}/fs/${route}?path=${encodeURIComponent(p.path || "~")}`),
})
