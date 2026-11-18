// APNs needs `inbox.apns` {key_id, team_id, key} in data/config.json; a token Apple says is gone is forgotten.
import crypto from "node:crypto"
import fs from "node:fs"
import http2 from "node:http2"
import path from "node:path"
import { z } from "zod"
import { LOCAL } from "../../../core/plugins.ts"
import { str, writeAtomic } from "../../../core/vault.ts"

export type Device = { token: string; env: "sandbox" | "production"; topic: string; name: string; t: number; widgets?: boolean }
export type Apns = { key_id: string; team_id: string; key: string }
export const BODY_MAX = 500
export type Note = { title: string; body?: string; category?: "permission" | "reply" | "event"; thread?: string; urgent?: boolean; data?: Record<string, string> }

const FILE = () => path.join(LOCAL, "push", "devices.json")
const HOSTS = { sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" }

export function devices(): Device[] {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), "utf8"))
    return Array.isArray(d.devices) ? d.devices.filter((x: Device) => x && /^[0-9a-f]{32,200}$/.test(x.token)) : []
  } catch {
    return []
  }
}

function save(list: Device[]) {
  writeAtomic(FILE(), JSON.stringify({ devices: list }, null, 2), { mode: 0o600 })
}

export function register(b: Record<string, unknown>): Device {
  const token = str(b.token).toLowerCase()
  if (!/^[0-9a-f]{32,200}$/.test(token)) throw new Error("token: the device's push token, in hex")
  const topic = str(b.topic)
  if (!/^[\w.-]{3,200}$/.test(topic)) throw new Error("topic: the app's bundle id")
  const d: Device = { token, env: b.env === "production" ? "production" : "sandbox", topic, name: str(b.name).slice(0, 80) || "iPhone", t: Date.now(),
    ...(b.widgets === true ? { widgets: true } : {}) }
  // A phone's widgets have one token at a time: a new one replaces the old.
  save([d, ...devices().filter((x) => x.token !== token && !(d.widgets && x.widgets && x.name === d.name && x.topic === topic))])
  return d
}

export function forget(token: string) {
  const before = devices()
  const after = before.filter((x) => x.token !== token.toLowerCase())
  if (after.length !== before.length) save(after)
  return after.length !== before.length
}

function keyOf(cfg: Apns | null) {
  if (!cfg?.key_id || !cfg.team_id || !cfg.key) return null
  try {
    return crypto.createPrivateKey(fs.readFileSync(path.isAbsolute(cfg.key) ? cfg.key : path.join(LOCAL, cfg.key)))
  } catch {
    return null
  }
}

let jwt: { token: string; t: number; kid: string } | null = null
/** The provider token: an ES256 JWT, kept 50 minutes (Apple wants a new one at most every 20, at least every 60). */
function bearer(cfg: Apns, key: crypto.KeyObject) {
  if (jwt && jwt.kid === cfg.key_id && Date.now() - jwt.t < 50 * 60_000) return jwt.token
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const input = `${b64({ alg: "ES256", kid: cfg.key_id })}.${b64({ iss: cfg.team_id, iat: Math.floor(Date.now() / 1000) })}`
  const sig = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")
  jwt = { token: `${input}.${sig}`, t: Date.now(), kid: cfg.key_id }
  return jwt.token
}

export function payload(n: Note) {
  return {
    aps: {
      alert: { title: n.title.slice(0, 200), ...(n.body ? { body: n.body.slice(0, BODY_MAX) } : {}) },
      sound: "default",
      ...(n.category ? { category: n.category } : {}),
      ...(n.thread ? { "thread-id": n.thread } : {}),
      "interruption-level": n.urgent ? "time-sensitive" : "active",
    },
    ...n.data,
  }
}

const IDLE_MS = 10 * 60_000, ANSWER_MS = 10_000
const sessions = new Map<string, http2.ClientHttp2Session>()
function session(origin: string, o: http2.SecureClientSessionOptions) {
  const was = sessions.get(origin)
  if (was && !was.closed && !was.destroyed) return was
  const s = http2.connect(origin, o)
  const drop = () => { if (sessions.get(origin) === s) sessions.delete(origin) }
  for (const e of ["error", "close", "goaway"]) s.on(e, drop)
  s.setTimeout(IDLE_MS, () => s.close())
  s.unref()
  sessions.set(origin, s)
  return s
}

type Answer = { status: number; reason: string; answered: boolean }
const Refusal = z.object({ reason: z.string() })
const reasonIn = (body: string) => { try { return Refusal.parse(JSON.parse(body)).reason } catch { return "" } }
function once(origin: string, o: http2.SecureClientSessionOptions, headers: http2.OutgoingHttpHeaders, body: string, wait: number): Promise<Answer> {
  return new Promise((resolve) => {
    const s = session(origin, o)
    let status = 0, data = "", settled = false
    const deadUnlessAnswered = (a: Answer) => { if (!a.answered) s.destroy() }
    const done = (a: Answer) => { if (settled) return; settled = true; deadUnlessAnswered(a); resolve(a) }
    const req = s.request(headers)
    req.setTimeout(wait, () => { req.close(); done({ status, reason: "timed out", answered: status > 0 }) })
    req.on("response", (h) => { status = Number(h[":status"]) })
    req.on("data", (c) => { data += c })
    req.on("end", () => done({ status, reason: reasonIn(data), answered: status > 0 }))
    req.on("error", (e) => done({ status, reason: e.message, answered: status > 0 }))
    req.on("close", () => done({ status, reason: "the connection closed", answered: status > 0 }))
    req.end(body)
  })
}

export async function apnsPostTriedTwiceUnanswered(origin: string, headers: http2.OutgoingHttpHeaders, body: string, o: http2.SecureClientSessionOptions = {}, wait = ANSWER_MS) {
  const first = await once(origin, o, headers, body, wait)
  if (first.answered) return { status: first.status, reason: first.reason }
  const again = await once(origin, o, headers, body, wait)
  return { status: again.status, reason: again.reason }
}

function post(d: Device, cfg: Apns, key: crypto.KeyObject, body: string): Promise<{ status: number; reason: string }> {
  const kind = d.widgets ? { "apns-topic": `${d.topic}.push-type.widgets`, "apns-push-type": "widgets" } : { "apns-topic": d.topic, "apns-push-type": "alert" }
  return apnsPostTriedTwiceUnanswered(HOSTS[d.env], {
    ":method": "POST", ":path": `/3/device/${d.token}`, authorization: `bearer ${bearer(cfg, key)}`,
    ...kind, "apns-priority": "10", "apns-id": crypto.randomUUID(), "content-type": "application/json",
  }, body)
}

export const send = (cfg: Apns | null, n: Note) => sendTo(devices().filter((d) => !d.widgets), cfg, JSON.stringify(payload(n)))

/** Tell the phones' widgets their data changed: they reload (iOS budgets these, so only on a real change). */
export const refresh = (cfg: Apns | null) => sendTo(devices().filter((d) => d.widgets), cfg, JSON.stringify({ aps: { "content-changed": true } }))

async function sendTo(list: Device[], cfg: Apns | null, body: string): Promise<{ sent: number; failed: string[]; ready: boolean }> {
  const key = keyOf(cfg)
  if (!key || !cfg || !list.length) return { sent: 0, failed: [], ready: !!key }
  const results = await Promise.all(list.map((d) => post(d, cfg, key, body)))
  const gone = list.filter((_d, i) => results[i].status === 410 || results[i].reason === "BadDeviceToken" || results[i].reason === "Unregistered")
  for (const d of gone) forget(d.token)
  const failed = results.map((r, i) => (r.status === 200 ? "" : `${list[i].name}: ${r.reason || r.status}`)).filter(Boolean)
  return { sent: results.filter((r) => r.status === 200).length, failed, ready: true }
}

export const configured = (cfg: Apns | null) => !!keyOf(cfg)
