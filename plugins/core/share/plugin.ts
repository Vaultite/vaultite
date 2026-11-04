// Sharing: a folder shared with one guest by a link of their own (gateway.ts serves it on MCP's public listener). Shares
// are kept in this machine's data/config.json ("share"), each link only as its hash.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { byUser, HTTPError, localDate, type OpCtx, OpError, Plugin, whoOf } from "../../../core/plugins.ts"
import { expired, folderSize, Gateway, ID, ROOM, type Role, type Share, sha } from "./gateway.ts"
import { machines } from "./machines.ts"

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
  mirror()
}
/** Where the vault is on the internet (MCP's public listener), "" when it isn't. */
const publicUrl = () => String((plugin.secrets().mcp as { public?: { url?: string } } | undefined)?.public?.url ?? "").replace(/\/+$/, "")
const others = machines(plugin, publicUrl)

/** Who each folder is shared with, for the app (/api/state's `sharedFolders`: the tree marks them): never a link's hash.
 *  This machine's shares, and the ones the vault's machine on the internet keeps (`kept`, asked now and then). */
type People = Record<string, { guest: string; role: Role; expires: string }[]>
let kept: Shared[] = []
const mirror = () => plugin.keep("folders", [...Object.entries(shares()).map(([id, s]) => listed(id, s)), ...kept].filter((s) => !s.expired)
  .reduce<People>((out, s) => ((out[s.folder] ??= []).push({ guest: s.guest, role: s.role, expires: s.expires }), out), {}))
/** What another machine keeps for this one (its shares, whether links can be made) asked again. */
async function refresh() {
  try {
    const w = await others.where()
    plugin.keep("links", !!w)
    kept = w && "host" in w ? await others.passOn<Shared[]>(w.host, "share.list", {}) : []
  } catch { /* it doesn't answer: as it was */ }
  mirror()
}
plugin.onSync(() => { mirror(); if (!publicUrl()) void refresh() })
const refresher = setInterval(() => { if (!publicUrl()) void refresh() }, 120_000)
refresher.unref()
plugin.onUnload(() => clearInterval(refresher))
// (`shareLinks`: this machine can make links: on the internet, or another of the user's is)
plugin.state(() => ({ sharedFolders: plugin.kept<People>("folders", {}), shareLinks: !!publicUrl() || plugin.kept<boolean>("links", false) }))

// (when a guest was last here, written at most every 10 minutes)
const seen = new Map<string, number>()
const gateway = new Gateway(plugin, shares, (id) => {
  if (Date.now() - (seen.get(id) ?? 0) < 600_000) return
  seen.set(id, Date.now())
  save((all) => { if (all[id]) all[id].used = new Date().toISOString() })
}, (x) => others.keeper((r) => (ID.test(x) ? r.id === x : r.hash === sha(x))))
plugin.provide("share:public", (req, res) => gateway.handle(req, res))
plugin.provide("share:upgrade", (req, socket, head) => gateway.upgrade(req, socket, head))
plugin.provide("share:gateway", () => gateway)
plugin.onChange((paths) => gateway.changed(paths))
const sharedFolders = () => [...new Set(Object.values(shares()).filter((s) => !expired(s)).map((s) => s.folder))]
/** The folders shared now (not expired): the vault's other machines type in their notes here, with the guests. */
plugin.provide("share:folders", sharedFolders)
/** The vault's other machines that share folders now, and which. */
plugin.provide("share:hosts", async () => (await others.othersNow()).filter((o) => o.same && o.folders.length).map(({ m, folders }) => ({ m, folders })))
plugin.route("GET", "share/folders", async (req) => {
  await plugin.ownerOnly(req, "The shared folders")
  // (`relayed`: the shares a machine on the internet passes on, by their links' hashes)
  return { folders: sharedFolders(), links: publicUrl() || null,
    relayed: Object.entries(shares()).filter(([, s]) => s.via && !expired(s)).map(([id, s]) => ({ id, hash: s.token })) }
}, { lock: false, sync: false })
// A guest's request or socket the machine on the internet passed on, for a share kept here: answered as at its address.
for (const method of ["GET", "POST", "PUT"]) plugin.route(method, "share/relay", async (req) => {
  await plugin.ownerOnly(req, "Passing on shared folders")
  if (!req.http) throw new HTTPError(400, "only over HTTP")
  return gateway.relayed(req.http)
}, { stream: true, lock: false })
plugin.socket("share/relay", (ws, req) => gateway.attachRelayed(ws, req), {
  accept: async (req) => {
    const why = await plugin.refusal(req, "Passing on shared folders")
    if (why) throw new HTTPError(403, why)
    if (!gateway.admitRelayed(req)) throw new HTTPError(403, "not a guest's socket")
  },
})
// Sockets of shares revoked or expired since they opened close; the rest are kept alive through the tunnel.
const pinger = setInterval(() => {
  for (const [ws, { g }] of gateway.sockets) {
    if (!gateway.holds(g)) ws.terminate()
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

/** Where a link is made (machines.ts): here, the vault's machine on the internet, or one that passes it on. */
async function where(ctx: OpCtx) {
  const w = await others.where(ctx)
  if (!w) throw new OpError("sharing needs a machine of yours on the internet: set mcp.public's url and port in data/config.json there, behind a tunnel (vau docs mcp)", 409)
  return w
}
/** The vault's machine that keeps this one's shares, when there is one (this one has no public address). */
async function hostOf(ctx: OpCtx) {
  const w = publicUrl() ? null : await others.where(ctx)
  return w && "host" in w ? w.host : null
}
/** The kept list again, after an op passed on changed it. */
const changed = () => void refresh()

/** An agent (not the user's own hand: the app, vau typed by them) sharing or unsharing waits for the user's yes, asked
 *  in the Inbox and on their phone, as an app on the internet's risky ops do. */
async function yes(ctx: OpCtx, op: string, params: Record<string, unknown>, what: string) {
  // (a machine passing one on asked there first)
  if (byUser(ctx.who) || ctx.who.client?.startsWith("machine/")) return
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
type Shared = ReturnType<typeof listed>
const line = (s: Shared) => `- ${s.id}: ${s.folder} with ${s.guest}, ${s.role}, ${s.expired ? "expired" : `until ${localDate(Date.parse(s.expires))}`}${s.used ? `, last here ${localDate(Date.parse(s.used))}` : ""}`

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
    if (!name) throw new OpError("`guest`: who it's for")
    if (reserved(name)) throw new OpError(`${name} is an agent's name or one the app uses: give the guest their own`)
    if (!ROLES.includes(role)) throw new OpError(`\`role\` is one of ${ROLES.join(", ")}`)
    const n = Math.round(Number(days))
    if (!(n >= 1 && n <= 365)) throw new OpError("`days`: 1 to 365")
    const w = await where(ctx)
    await yes(ctx, "share.create", { folder: rel, guest: name, role, days: n }, `share ${rel} with ${name} (${role}, ${n} days) over the internet`)
    // (the vault's machine on the internet keeps it, serving the folder itself)
    if ("host" in w) {
      const made = await others.passOn<Shared & { link: string }>(w.host, "share.create", { folder: rel, guest: name, role, days: n })
      changed()
      return made
    }
    const url = "here" in w ? w.here : w.url
    const id = crypto.randomBytes(8).toString("base64url"), token = crypto.randomBytes(32).toString("base64url")
    const s: Share = { folder: rel, guest: name, role, created: new Date().toISOString(), expires: new Date(Date.now() + n * 86_400_000).toISOString(), token: sha(token),
      ...("via" in w ? { via: w.via.id } : {}),
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
  run: async ({ folder }, ctx) => {
    const w = await others.where(ctx), host = w && "host" in w ? w.host : null
    plugin.keep("links", !!w)
    const theirs = host ? await others.passOn<Shared[]>(host, "share.list", folder ? { folder } : {}) : []
    if (host && !folder) { kept = theirs; mirror() }
    return [...theirs, ...Object.entries(shares()).filter(([, s]) => !folder || s.folder === folder).map(([id, s]) => listed(id, s))]
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.created.localeCompare(b.created))
  },
  text: (r: Shared[]) => (r.length ? r.map(line).join("\n") : "No folder is shared."),
})

plugin.op({
  id: "share.update",
  cli: "share update",
  owner: OWNER,
  summary: "Change what a share's guest may do (read, comment, edit), or how long their link works from now; the link stays the same.",
  help: "Its id is in `vau share list`.\n\n  vau share update <id> --role edit\n  vau share update <id> --days 30",
  kind: "write",
  params: {
    id: { type: "string", required: true, description: "the share's id (vau share list)" },
    role: { type: "string", enum: ROLES, description: "read; comment: and add comments; edit: and change its notes" },
    days: { type: "number", description: "the link works this many days from now (1 to 365)" },
  },
  args: ["id"],
  lock: false,
  run: async ({ id, role, days }, ctx) => {
    if (role !== undefined && !ROLES.includes(role)) throw new OpError(`\`role\` is one of ${ROLES.join(", ")}`)
    const n = days === undefined ? null : Math.round(Number(days))
    if (n !== null && !(n >= 1 && n <= 365)) throw new OpError("`days`: 1 to 365")
    if (role === undefined && n === null) throw new OpError("say what changes: `role` or `days`")
    let s = shares()[id]
    const host = s ? null : await hostOf(ctx), there = kept.find((x) => x.id === id)
    if (!s && !host) throw new OpError(`no share ${id} (vau share list)`, 404)
    const who = s ?? there
    await yes(ctx, "share.update", { id, role, days: n }, `change ${who ? `${who.guest}'s access to ${who.folder}` : `a share's access (${id})`} (${[role, n && `${n} days`].filter(Boolean).join(", ")})`)
    if (host) {
      const r = await others.passOn<Shared>(host, "share.update", { id, ...(role ? { role } : {}), ...(n ? { days: n } : {}) })
      changed()
      return r
    }
    s = shares()[id]
    if (!s) throw new OpError(`no share ${id} (vau share list)`, 404)
    const was = s.role
    save((all) => { all[id] = { ...all[id], ...(role ? { role } : {}), ...(n ? { expires: new Date(Date.now() + n * 86_400_000).toISOString() } : {}) } })
    // (their open pages come back with what they may do now)
    if (role && role !== was) gateway.close(id)
    return listed(id, shares()[id])
  },
  text: (r) => `${r.guest} can ${r.role === "read" ? "view" : r.role} ${r.folder} until ${localDate(Date.parse(r.expires))}.`,
  did: (p) => ({ action: "settings", text: `Changed a share (${p.id})` }),
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
    const host = s ? null : await hostOf(ctx), there = kept.find((x) => x.id === id)
    if (!s && !host) throw new OpError(`no share ${id} (vau share list)`, 404)
    const who = s ?? there
    await yes(ctx, "share.revoke", { id }, who ? `stop sharing ${who.folder} with ${who.guest}` : `turn off a share (${id})`)
    if (host) {
      const r = await others.passOn<Shared>(host, "share.revoke", { id })
      changed()
      return r
    }
    s = shares()[id]
    if (!s) throw new OpError(`no share ${id} (vau share list)`, 404)
    save((all) => { delete all[id] })
    gateway.close(id)
    return listed(id, s)
  },
  text: (r) => `${r.guest} can't open ${r.folder} any more.`,
  did: (p) => ({ action: "settings", text: `Stopped sharing (${p.id})` }),
})
