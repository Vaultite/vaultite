// Pages a phone's Safari opens (over https: passkeys need it) to approve an agent's login or add the passkey that does;
// the desktop app checks their answers (electron/browser/logins.ts). Routes, never ops: no agent answers for the user.
import { HTTPError, type Plugin, servedAt, Text } from "../../../core/plugins.ts"

const HEADERS = { "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }

/** A page of the approvals': its title, and its script (an async body with `api`, `say`, `b64u`, `bytes` and `$`). */
const page = (title: string, script: string) => new Text(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
:root { color-scheme: light dark; font: 17px/1.4 -apple-system, system-ui, sans-serif }
body { margin: 0; padding: 48px 24px; max-width: 420px; margin-inline: auto; text-align: center }
h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px } p { margin: 8px 0; color: color-mix(in srgb, currentColor 70%, transparent) }
button { font: inherit; font-weight: 600; width: 100%; min-height: 50px; border: 0; border-radius: 12px; margin-top: 12px; cursor: pointer }
.yes { background: #0a84ff; color: white } .no { background: color-mix(in srgb, currentColor 10%, transparent); color: inherit }
button[hidden] { display: none }
dl { text-align: left; margin: 20px 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px } dt { color: color-mix(in srgb, currentColor 60%, transparent) }
dd { margin: 0; font-weight: 600; overflow-wrap: anywhere }
</style></head><body><h1 id="title">${title}</h1><dl id="facts"></dl><p id="what"></p><p id="say"></p>
<button class="yes" id="yes" hidden></button><button class="no" id="no" hidden></button>
<script>(async () => {
  const $ = (id) => document.getElementById(id)
  const say = (t) => { $("say").textContent = t }
  const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "")
  const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  const api = async (method, path, body) => {
    const r = await fetch("/api/web-viewer/" + path, { method, headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/approvals" }, body: body && JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || "the server answered " + r.status)
    return j
  }
  if (!window.PublicKeyCredential) return say("This needs a passkey, which this browser can't use here: open the link in Safari.")
  try { ${script} } catch (e) { say("Couldn't: " + e.message) }
})()</script></body></html>`, "text/html; charset=utf-8", HEADERS)

const APPROVE = `
  const grant = new URLSearchParams(location.search).get("grant") || ""
  const o = await api("GET", "approve/options?grant=" + encodeURIComponent(grant))
  // (what Face ID says yes to, in full: the site, the entry, who asks and for what)
  for (const [k, v] of [["Site", o.site], ["Entry", o.entry.title], ["Username", o.entry.username], ["Agent", o.agent], ["Task", o.task]]) {
    if (!v) continue
    const dt = document.createElement("dt"), dd = document.createElement("dd")
    dt.textContent = k; dd.textContent = v
    $("facts").append(dt, dd)
  }
  $("what").textContent = "The app fills the password; the agent never sees it. Your yes lasts 15 minutes, for this entry and this agent."
  if (o.state !== "waiting") return say(o.state === "approved" ? "Approved." : "You said no.")
  $("yes").textContent = "Approve with your passkey"; $("yes").hidden = false
  $("no").textContent = "Deny"; $("no").hidden = false
  $("no").onclick = async () => { await api("POST", "approve", { grant, deny: true }); $("yes").hidden = $("no").hidden = true; say("You said no.") }
  $("yes").onclick = async () => {
    try {
      const c = await navigator.credentials.get({ publicKey: { challenge: bytes(o.challenge), rpId: location.hostname, userVerification: "required", timeout: 120000,
        allowCredentials: o.allow.map((id) => ({ type: "public-key", id: bytes(id) })) } })
      await api("POST", "approve", { grant, id: c.id, clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData), signature: b64u(c.response.signature) })
      $("yes").hidden = $("no").hidden = true
      say("Approved: the agent goes on.")
    } catch (e) { say("Not approved: " + e.message + " Load this page again to try again.") }
  }`

const ADD = `
  const token = new URLSearchParams(location.search).get("token") || ""
  const o = await api("GET", "passkey/options?token=" + encodeURIComponent(token))
  $("what").textContent = "A passkey on this device, to approve agents' logins in the browser on your Mac. Then confirm on the Mac with Touch ID."
  $("yes").textContent = "Add a passkey"; $("yes").hidden = false
  $("yes").onclick = async () => {
    try {
      const c = await navigator.credentials.create({ publicKey: { challenge: bytes(o.challenge), rp: { id: location.hostname, name: "Vaultite" },
        user: { id: bytes(o.user), name: "Agents' logins", displayName: "Approve agents' logins" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" }, attestation: "none", timeout: 120000,
        excludeCredentials: o.exclude.map((id) => ({ type: "public-key", id: bytes(id) })) } })
      say("Confirm with Touch ID on your Mac…")
      const name = /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : "A device"
      const r = await api("POST", "passkey", { token, name, clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject) })
      $("yes").hidden = true
      say("Added: this " + r.name + " now approves agents' logins.")
    } catch (e) { say("Not added: " + e.message) }
  }`

export function approvals(plugin: Plugin) {
  const what = "Approving agents' logins"
  const desktop = async <T>(name: string, ...args: unknown[]) => {
    try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new HTTPError(409, (e as Error).message) }
  }
  const o = { lock: false, sync: false }
  plugin.route("GET", "web-viewer/approve", async (req) => { await plugin.ownerOnly(req, what); return page("Approve a login", APPROVE) }, o)
  plugin.route("GET", "web-viewer/approve/options", async (req) => { await plugin.ownerOnly(req, what); return desktop("agent:login-options", String(req.query.grant ?? "")) }, o)
  plugin.route("POST", "web-viewer/approve", async (req) => {
    await plugin.ownerOnly(req, what)
    const b = (req.body ?? {}) as Record<string, unknown>
    return desktop("agent:login-answer", String(b.grant ?? ""), b.deny === true ? { deny: true }
      : { id: String(b.id ?? ""), clientDataJSON: String(b.clientDataJSON ?? ""), authenticatorData: String(b.authenticatorData ?? ""), signature: String(b.signature ?? "") })
  }, o)
  plugin.route("GET", "web-viewer/passkey", async (req) => { await plugin.ownerOnly(req, what); return page("Add a passkey", ADD) }, o)
  plugin.route("GET", "web-viewer/passkey/options", async (req) => { await plugin.ownerOnly(req, what); return desktop("agent:passkey-options", String(req.query.token ?? "")) }, o)
  plugin.route("POST", "web-viewer/passkey", async (req) => {
    await plugin.ownerOnly(req, what)
    const b = (req.body ?? {}) as Record<string, unknown>
    return desktop("agent:passkey-add", String(b.token ?? ""), { clientDataJSON: String(b.clientDataJSON ?? ""), attestationObject: String(b.attestationObject ?? "") },
      String(b.name ?? "").slice(0, 60))
  }, o)
  // (where the phone reaches this server over https, for the app's QR code)
  plugin.route("GET", "web-viewer/https", async (req) => { await plugin.ownerOnly(req, what); return { url: await servedAt(Number(process.env.PORT || 8793)) } }, o)
}
