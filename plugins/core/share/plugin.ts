// Sharing: a folder shared with one guest by a link of their own (gateway.ts serves it on MCP's public listener). Shares
// are kept in this machine's data/config.json ("share"), each link only as its hash.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { byUser, localDate, type OpCtx, OpError, Plugin, whoOf } from "../../../core/plugins.ts"
import { expired, folderSize, Gateway, ROOM, type Role, type Share, sha } from "./gateway.ts"

export const plugin = new Plugin(import.meta.url)

const ROLES: Role[] = ["read", "comment", "edit"]
const OWNER = "sharing folders"
type Stored = { shares?: Record<string, Share> }

const stored = (): Stored => (plugin.secrets().share as Stored | undefined) ?? {}
export const shares = () => stored().shares ?? {}
function save(fn: (all: Record<string, Share>) => void) {
  const s = structuredClone(stored())
  s.shares ??= {}
  fn(s.shares)
  plugin.saveSecrets(s)
}

// (when a guest was last here, written at most every 10 minutes)
const seen = new Map<string, number>()
const gateway = new Gateway(plugin, shares, (id) => {
  if (Date.now() - (seen.get(id) ?? 0) < 600_000) return
  seen.set(id, Date.now())
  save((all) => { if (all[id]) all[id].used = new Date().toISOString() })
})
plugin.provide("share:public", (req, res) => gateway.handle(req, res))
plugin.provide("share:upgrade", (req, socket, head) => gateway.upgrade(req, socket, head))
plugin.provide("share:gateway", () => gateway)
plugin.onChange((paths) => gateway.changed(paths))
// Sockets of shares revoked or expired since they opened close; the rest are kept alive through the tunnel.
const pinger = setInterval(() => {
  for (const [ws, { g }] of gateway.sockets) {
    const s = shares()[g.id]
    if (!s || s.token !== g.share.token || expired(s)) ws.close()
    else ws.send(JSON.stringify({ type: "ping" }))
  }
}, 25_000)
pinger.unref()
plugin.onUnload(() => clearInterval(pinger))

/** A folder that can be shared: there, not hidden, not the vault itself, and not a link out of it; as it's named on disk. */
function folderOf(p: unknown) {
  const rel = String(p ?? "").replaceAll("\\", "/").split("/").filter((x) => x && x !== ".").join("/")
  if (!rel) throw new OpError("name a folder: the whole vault is never shared")
  if (rel.split("/").some((x) => x === ".." || x.startsWith("."))) throw new OpError(`${rel} is hidden: it can't be shared`)
  const abs = plugin.vault.abs(rel)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new OpError(`no folder '${rel}'`, 404)
  const root = fs.realpathSync.native(plugin.vault.path), real = fs.realpathSync.native(abs)
  if (!real.startsWith(root + path.sep)) throw new OpError(`${rel} is a link to a folder outside the vault: it can't be shared`)
  return path.relative(root, real).split(path.sep).join("/")
}

/** A name that's an agent's (Claude, Codex...), or the app's own words for people ("You", "Owner"): never a guest's. */
function reserved(name: string) {
  const who = whoOf("cli", name), companion = String(plugin.peer("companion")?.settings().name ?? "")
  return who.source !== name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    || /^(you|owner|guest|companion|claude|codex|gemini|cursor|chatgpt|agent)$/i.test(name.trim()) || (!!companion && companion.toLowerCase() === name.trim().toLowerCase())
}

/** Where the vault is on the internet (MCP's public listener), for links. */
function base() {
  const url = (plugin.secrets().mcp as { public?: { url?: string } } | undefined)?.public?.url
  if (!url) throw new OpError("sharing needs this vault on the internet: set mcp.public's url and port in data/config.json, behind a tunnel (vau docs mcp)", 409)
  return String(url).replace(/\/+$/, "")
}

/** An agent (not the user's own hand: the app, vau typed by them) sharing or unsharing waits for the user's yes, asked
 *  in the Inbox and on their phone, as an app on the internet's risky ops do. */
async function yes(ctx: OpCtx, op: string, params: Record<string, unknown>, what: string) {
  if (byUser(ctx.who)) return
  const ask = plugin.service("inbox:ask"), answerOf = plugin.service("inbox:answer")
  if (!ask || !answerOf) throw new OpError(`${what} needs the user's yes, asked in the Inbox, which is off: they can do it themselves (a folder's menu, Share…)`, 403)
  const key = sha(JSON.stringify([op, params])).slice(0, 40)
  const event = await ask({ source: "share", key, title: `${ctx.who.label} asks to ${what}`, body: `${op} ${JSON.stringify(params, null, 2)}` })
  const answer = await answerOf(event, 45_000)
  if (answer === "approve" || answer === "deny") plugin.service("inbox:drop")?.("share", key)
  if (answer === "approve") return
  if (answer === "deny") throw new OpError(`The user said no: don't ${what}.`, 403)
  throw new OpError(`Waiting for the user's yes: Vaultite asked them in the Inbox and on their phone whether you may ${what}. Tell them, and run this again with the same arguments once they approve.`, 409)
}

const listed = (id: string, s: Share) => ({ id, folder: s.folder, guest: s.guest, role: s.role, created: s.created, expires: s.expires, expired: expired(s), used: s.used ?? null })
const line = (s: ReturnType<typeof listed>) => `- ${s.id}: ${s.folder} with ${s.guest}, ${s.role}, ${s.expired ? "expired" : `until ${localDate(Date.parse(s.expires))}`}${s.used ? `, last here ${localDate(Date.parse(s.used))}` : ""}`

plugin.op({
  id: "share.create",
  cli: "share create",
  owner: OWNER,
  summary: "Share a folder with one person: a link of their own, to read it in a browser (and comment or edit, by role) until it expires.",
  help: `The link is shown only now (it's kept as a hash): send it to that person only. They see the folder and nothing else
of the vault; read, comment (margin threads) or edit (its notes). \`days\` it lasts (default 30); \`vau share revoke\` ends it sooner.

  vau share create "Projects/Lighthouse" --guest "Alice Park" --role comment --days 14`,
  kind: "write",
  params: {
    folder: { type: "string", format: "path", required: true, description: "the folder to share (a vault path)" },
    guest: { type: "string", required: true, description: "who it's for: their name, as their comments and edits show" },
    role: { type: "string", enum: ROLES, default: "read", description: "read; comment: and add comments; edit: and change its notes" },
    days: { type: "number", default: 30, description: "how many days the link works (1 to 365)" },
  },
  args: ["folder"],
  lock: false, // (an agent's call waits for the user's yes)
  run: async ({ folder, guest, role = "read", days = 30 }, ctx) => {
    const rel = folderOf(folder), name = String(guest).trim().slice(0, 60)
    if (!name) throw new OpError("guest: who it's for")
    if (reserved(name)) throw new OpError(`${name} is an agent's name or one the app uses: give the guest their own`)
    if (!ROLES.includes(role)) throw new OpError(`role is one of ${ROLES.join(", ")}`)
    const n = Math.round(Number(days))
    if (!(n >= 1 && n <= 365)) throw new OpError("days: 1 to 365")
    const url = base()
    await yes(ctx, "share.create", { folder: rel, guest: name, role, days: n }, `share ${rel} with ${name} (${role}, ${n} days) over the internet`)
    const id = crypto.randomBytes(8).toString("base64url"), token = crypto.randomBytes(32).toString("base64url")
    const s: Share = { folder: rel, guest: name, role, created: new Date().toISOString(), expires: new Date(Date.now() + n * 86_400_000).toISOString(), token: sha(token),
      room: (({ notes, bytes }) => ({ notes: notes + ROOM.notes, bytes: bytes + ROOM.bytes }))(folderSize(plugin.vault, rel)) }
    save((all) => { all[id] = s })
    return { ...listed(id, s), link: `${url}/s/${token}` }
  },
  text: (r) => `Shared ${r.folder} with ${r.guest} (${r.role}) until ${localDate(Date.parse(r.expires))}: ${r.link}\nThis link is shown only now: send it to ${r.guest} only.`,
  did: (p) => ({ action: "settings", text: `Shared ${p.folder} with ${p.guest}`, paths: [String(p.folder)] }),
})

plugin.op({
  id: "share.list",
  cli: "share list",
  owner: OWNER,
  summary: "The folders shared and with whom: role, until when, when they were last there.",
  help: "  vau share list\n  vau share list Projects/Lighthouse",
  kind: "read",
  params: { folder: { type: "string", format: "path", description: "only this folder's shares" } },
  args: ["folder"],
  run: ({ folder }) => Object.entries(shares()).filter(([, s]) => !folder || s.folder === folder).map(([id, s]) => listed(id, s))
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.created.localeCompare(b.created)),
  text: (r: ReturnType<typeof listed>[]) => (r.length ? r.map(line).join("\n") : "No folder is shared."),
})

plugin.op({
  id: "share.revoke",
  cli: "share revoke",
  owner: OWNER,
  summary: "Turn a share off: its link stops working at once, and its guest's open pages stop.",
  help: "Its id is in `vau share list`.\n\n  vau share revoke <id>",
  kind: "destructive",
  params: { id: { type: "string", required: true, description: "the share's id (vau share list)" } },
  args: ["id"],
  lock: false,
  run: async ({ id }, ctx) => {
    let s = shares()[id]
    if (!s) throw new OpError(`no share ${id} (vau share list)`, 404)
    await yes(ctx, "share.revoke", { id }, `stop sharing ${s.folder} with ${s.guest}`)
    s = shares()[id]
    if (!s) throw new OpError(`no share ${id} (vau share list)`, 404)
    save((all) => { delete all[id] })
    gateway.close(id)
    return listed(id, s)
  },
  text: (r) => `${r.guest} can't open ${r.folder} any more.`,
  did: (p) => ({ action: "settings", text: `Stopped sharing (${p.id})` }),
})
