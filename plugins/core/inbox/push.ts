// Phone push through APNs for each new event (the watch shows the phone's). Needs `inbox.apns` {key_id, team_id, key}
// in data/config.json (never the vault); devices are kept per machine, and tokens Apple says are gone are forgotten.
import crypto from "node:crypto"
import fs from "node:fs"
import http2 from "node:http2"
import path from "node:path"
import { LOCAL } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"

export type Device = { token: string; env: "sandbox" | "production"; topic: string; name: string; t: number; widgets?: boolean }
export type Apns = { key_id: string; team_id: string; key: string }
/** The most of a body a notification shows. */
export const BODY_MAX = 500
/** What a notification says and does: its buttons come from its category (Push.swift registers them). */
export type Note = { title: string; body?: string; category?: "permission" | "event"; thread?: string; urgent?: boolean; data?: Record<string, string> }

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
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  const tmp = `${FILE()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ devices: list }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE())
}

/** Add a device, or update it (the same token). Throws on one that isn't a device token. */
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

/** The key to sign with, from the config: null when push isn't set up here. */
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

/** The notification's JSON (aps and the event's own keys). */
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

function post(d: Device, cfg: Apns, key: crypto.KeyObject, body: string): Promise<{ status: number; reason: string }> {
  const kind = d.widgets ? { "apns-topic": `${d.topic}.push-type.widgets`, "apns-push-type": "widgets" } : { "apns-topic": d.topic, "apns-push-type": "alert" }
  return new Promise((resolve) => {
    const client = http2.connect(HOSTS[d.env])
    const done = (status: number, reason: string) => { client.close(); resolve({ status, reason }) }
    client.on("error", (e) => done(0, e.message))
    const req = client.request({
      ":method": "POST", ":path": `/3/device/${d.token}`, authorization: `bearer ${bearer(cfg, key)}`,
      ...kind, "apns-priority": "10", "content-type": "application/json",
    })
    let status = 0, data = ""
    req.setTimeout(10_000, () => { req.close(); done(0, "timed out") })
    req.on("response", (h) => { status = Number(h[":status"]) })
    req.on("data", (c) => { data += c })
    req.on("end", () => { let reason = ""; try { reason = JSON.parse(data).reason ?? "" } catch { /* empty when sent */ } done(status, reason) })
    req.on("error", (e) => done(0, e.message))
    req.end(body)
  })
}

/** Send to every device; forgets the ones Apple says are gone. What happened to each. */
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
