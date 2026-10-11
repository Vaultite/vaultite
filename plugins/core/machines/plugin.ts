// Machines: other computers serving this vault's app, in its settings (a server adds itself once; entries are the
// user's). No accounts: whoever reaches one machine reaches the others through it, but shells stay the owner's.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { API_VERSION, APP_VERSION, bullets, HTTPError, LOADED, MACHINE_CLIENT, Plugin, reply, ROOT, section, Text } from "../../../core/plugins.ts"
import { dialIn, type DialEntry } from "./dial.ts"
import type { Item } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

export type Machine = {
  id: string; label: string; url: string; online: boolean; self: boolean
  dial?: boolean; readOnly?: boolean; via?: string; home?: string
  host?: string; platform?: string; version?: string; commit?: string; plugins?: string[]; vault?: string; error?: string
}

const INSTANCE = crypto.randomUUID()
const HOST = os.hostname().replace(/\.local$/, "")
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/

/** A host name as a machine id: "Studio-Mac.local" -> "studio-mac". */
export const slug = (s: string) => s.toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63)

/** The app's commit (which version each machine runs): its checkout's, or the packaged desktop app's electron/build.json. */
const commit = new Promise<string>((resolve) => {
  execFile("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { timeout: 3000 }, (err, out) => {
    if (!err) return resolve(out.trim())
    try {
      resolve(String(JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "build.json"), "utf8")).commit ?? "").slice(0, 7))
    } catch {
      resolve("")
    }
  })
})

/** The machines in the settings, checked: a usable id and an http(s) url, each id once. */
function listed(): DialEntry[] {
  const raw = plugin.settings({}).machines
  const out: DialEntry[] = []
  for (const m of Array.isArray(raw) ? raw as Item[] : []) {
    const id = String(m?.id ?? "").toLowerCase(), url = String(m?.url ?? "").replace(/\/+$/, "")
    const via = typeof m.via === "string" && ID.test(m.via) && m.via !== id ? m.via : undefined
    if (!ID.test(id) || (!via && !/^https?:\/\//.test(url)) || out.some((o) => o.id === id)) continue
    out.push({ id, label: String(m.label || id), url: via ? "" : url, ...(via ? { via } : {}) })
  }
  return out
}

function enabledPlugins() {
  const skip = plugin.vault.switchedOff()
  return LOADED.map((p) => p.id).filter((id) => !skip.has(id))
}

/** This vault's id (vault.json, made once while machines are listed, synced with the vault): machines that say the same
 *  one share it; "" when unknown. */
function vaultId(): string {
  let cur: Item | null
  try { cur = plugin.readSettings("vault") } catch { return "" } // there but unreadable (mid-sync)
  if (typeof cur?.id === "string" && cur.id) return cur.id
  if (!listed().length) return ""
  const id = crypto.randomUUID()
  plugin.saveSettings({ id }, "vault")
  return id
}

async function self() {
  return { instance: INSTANCE, host: HOST, platform: process.platform, version: APP_VERSION, api: API_VERSION,
    commit: await commit, plugins: enabledPlugins(), vault: vaultId() }
}


const PORT = Number(process.env.PORT || 8793)
const LOOPBACK = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`)
/** This server's own address on the network (Tailscale Serve's handler to its port), or "". */
const ownUrl = async () => String(await plugin.ask("machines:url", "")).replace(/\/+$/, "")
/** An entry whose address is this very server's (no need to ask it). */
const knownOwn = new Set<string>()
const isOwn = (url: string, own: string) => LOOPBACK.test(url) || (!!own && url === own) || knownOwn.has(url)

const dial = dialIn(plugin, listed, selfId)

async function probe(m: DialEntry, own: string): Promise<Machine> {
  if (m.via) {
    const via = listed().find((e) => e.id === m.via && !e.via)
    if (via && (isOwn(via.url, own) || (await probe(via, own)).self)) return { ...m, ...dial.summary(m.id) }
    try {
      if (!via) throw new Error("missing relay")
      const r = await fetch(`${via.url}/api/machines/${m.id}/info`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(3000) })
      if (!r.ok) throw new Error("relay offline")
      return { ...m, ...(await r.json()), self: false, dial: true, readOnly: true, plugins: [] }
    } catch { return { ...m, online: false, self: false, dial: true, readOnly: true, plugins: [], error: "relay unavailable" } }
  }
  if (isOwn(m.url, own)) {
    const s = await self()
    return { ...m, online: true, self: true, host: s.host, platform: s.platform, version: s.version, commit: s.commit || undefined, plugins: s.plugins, vault: s.vault || undefined }
  }
  try {
    const r = await fetch(`${m.url}/api/machines/self`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { ...m, online: false, self: false, error: `answered ${r.status}` }
    const s = await r.json() as Item
    if (s.instance === INSTANCE) knownOwn.add(m.url)
    return { ...m, online: true, self: s.instance === INSTANCE, host: s.host, platform: s.platform, version: s.version,
      commit: s.commit || undefined, plugins: Array.isArray(s.plugins) ? s.plugins : [], vault: typeof s.vault === "string" && s.vault ? s.vault : undefined }
  } catch (e) {
    return { ...m, online: false, self: false, error: (e as Error).name === "TimeoutError" ? "no answer" : "unreachable" }
  }
}

async function machines(): Promise<Machine[]> {
  return plugin.memo(20, async function machines(key: string) {
    void key
    vaultId() // (made before another machine is asked, so it's there to compare)
    const own = await ownUrl()
    return Promise.all(listed().map((m) => probe(m, own)))
  }, JSON.stringify(listed()))
}

/** This server's id in the list (null: it isn't listed). By address first, without asking anyone; else by asking. */
async function selfId(): Promise<string | null> {
  const list = listed()
  if (!list.length) return null
  const own = await ownUrl()
  const hit = list.find((m) => !m.via && isOwn(m.url, own))
  if (hit) return hit.id
  return (await machines()).find((m) => m.self)?.id ?? null
}

async function machine(id: string) {
  return (await machines()).find((m) => m.id === id) ?? null
}

plugin.provide("machines", machines)
plugin.provide("machines:machine", machine)
plugin.provide("machines:self", selfId)
plugin.provide("machines:vault", vaultId)
plugin.provide("machines:ids", () => listed().map((m) => m.id)) // (the first runs the schedule: core/schedule.ts)

plugin.route("GET", "machines", () => machines())
plugin.route("GET", "machines/self", () => self())

plugin.route("GET", "machines/*/**", async (req) => {
  const id = req.arg(0), rest = req.arg(1)
  const m = listed().find((x) => x.id === id)
  if (!m) throw new HTTPError(404, `no machine '${id}' (the machines are in .vaultite/plugins/machines/data.json)`)
  if (m.via) {
    if (!["info", "fs/list", "fs/read"].includes(rest)) throw new HTTPError(404, "This machine only lists folders and reads files")
    const why = req.http ? await plugin.refusal(req.http, "Reading an agent machine's files") : ""
    if (why) throw new HTTPError(403, why)
    const via = listed().find((e) => e.id === m.via && !e.via)
    if (!via) throw new HTTPError(502, "The relay machine is missing")
    const own = await ownUrl()
    if (isOwn(via.url, own) || (await probe(via, own)).self) {
      if (rest === "info") return dial.summary(m.id)
      const op = rest === "fs/list" ? "ls" : "read"
      return dial.request(m.id, op, { path: req.query.path ?? "~" })
    }
    m.url = `${via.url}/api/machines/${encodeURIComponent(m.id)}`
  }
  const qs = new URLSearchParams(req.query).toString()
  let r: Response
  try {
    r = await fetch(`${m.url}${m.via ? "/" : "/api/"}${rest.split("/").map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`,
      { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new HTTPError(502, `${m.label} doesn't answer`)
  }
  const type = r.headers.get("content-type") ?? "application/octet-stream"
  const body = Buffer.from(await r.arrayBuffer())
  if (r.status === 200) return new Text(body, type)
  let err: unknown = { error: body.toString("utf8").slice(0, 500) }
  if (type.includes("json")) try { err = JSON.parse(body.toString("utf8")) } catch { /* as text */ }
  return reply(r.status, err)
}, { lock: false })

// --- adding itself

/** Add this server to the list once, when it knows its own address and isn't there yet (by id or by address). `added`
 *  remembers that it did: one the user removed stays removed. */
async function register() {
  const url = await ownUrl()
  if (/^https?:\/\//.test(url)) join(url)
}
function join(url: string) {
  let cur: Item | null
  try { cur = plugin.readSettings() } catch { return } // there but unreadable (mid-sync): leave it
  const list = Array.isArray(cur?.machines) ? cur.machines as Item[] : []
  const added = Array.isArray(cur?.added) ? (cur.added as unknown[]).map(String) : []
  const id = slug(HOST)
  if (!id) return
  const listed = list.some((m) => String(m?.url ?? "").replace(/\/+$/, "") === url || String(m?.id ?? "").toLowerCase() === id)
  if (added.includes(id)) return
  // (listed by hand, or added before `added` was kept: noted once, so removing it later sticks too)
  plugin.saveSettings({ ...(cur ?? {}), machines: listed ? list : [...list, { id, label: HOST, url }], added: [...added, id] })
  plugin.forget()
}
plugin.exports.join = join
const first = setTimeout(() => { if (plugin.loaded) void register() }, 5000)
const hourly = setInterval(() => { if (plugin.loaded) void register() }, 3600 * 1000)
first.unref?.(); hourly.unref?.()
plugin.onUnload(() => { clearTimeout(first); clearInterval(hourly) })

// --- blocks as text

plugin.block("machines", async () => {
  const ms = await machines()
  return section("Machines", bullets(ms.map((m) => `${m.label}${m.self ? " (this one)" : ""}: ${m.online
    ? ["online", m.host, m.version && `Vaultite ${m.version}${m.commit ? ` (${m.commit})` : ""}`].filter(Boolean).join(", ")
    : `offline (${m.error})`}${m.dial ? `, read-only files via ${m.via}` : `, ${m.url}`}`), "No machines yet: add them to .vaultite/plugins/machines/data.json."))
})


plugin.route("GET", "machines/enrollment", async (req) => {
  const why = req.http ? await plugin.refusal(req.http, "Enrolling agent machines") : ""
  if (why) throw new HTTPError(403, why)
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
  const answer = await r.json() as Item
  if (!r.ok) throw new HTTPError(r.status, String(answer.error || "The relay refused the request"))
  return answer
}
plugin.route("POST", "machines/*/approve", async (req) => {
  const why = req.http ? await plugin.refusal(req.http, "Enrolling agent machines") : ""
  if (why) throw new HTTPError(403, why)
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
