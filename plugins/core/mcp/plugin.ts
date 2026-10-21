// MCP: every op marked `mcp` is a tool (plus `ops` and `call`), over HTTP here, stdio (cli.ts) or the internet (public.ts;
// Vaultite Cloud: cloud.ts). Owner only, like a shell; the route is `lock: false`: each tool call holds the vault for a write.
import crypto from "node:crypto"
import { agentLines, APP_VERSION, HTTPError, OpError, Plugin, reply, type Request, Text, type Who } from "../../../core/plugins.ts"
import { appsFrom, contents, cspOf } from "./apps.ts"
import { toolsOf } from "./catalog.ts"
import { Cloud, type CloudStatus } from "./cloud.ts"
import { PublicMcp } from "./public.ts"
import { callTool, type Client, declared, handleBody, initializes, instructionsOf, type Session, type ToolCtx, ToolError, toolsWithApps } from "./protocol.ts"

export const plugin = new Plugin(import.meta.url)

/** Sessions by Mcp-Session-Id: who the client said it was. In memory; the newest 200. */
const sessions = new Map<string, Session>()


async function allowed(req: Request) {
  if (plugin.isOff()) throw new HTTPError(404, "the MCP plugin is off (Setup > Plugins)")
  await plugin.ownerOnly(req, "Vaultite's MCP server")
}

/** A tool's context: ops in-process, as the client, for the request it came in (its owner checks apply: an op's
 *  `owner`, the routes an op calls), each call told to Activity as `mcp <tool>`. */
function ctxFor(client: Who, tool: string, http: Request["http"]): ToolCtx {
  return { client, op: async (id, params) => plugin.host.call(id, params, client, { report: `mcp ${tool}`, http }) }
}

/** The cards of the plugins that are on (apps.ts), and the app's address on the internet for their links. */
const apps = () => appsFrom(plugin.allServices("mcp:apps"))
const appUrl = () => cloud.status().app

/** What initialize tells a client: composed from the plugins that are on now (protocol.ts instructionsOf). */
const instructions = () => instructionsOf(agentLines(plugin.vault).map((l) => l.text), plugin.host.catalog())

plugin.op({
  id: "mcp.instructions",
  summary: "What the MCP server tells an AI when it connects: a line from each plugin that's on, then how to use the tools.",
  help: "The instructions in MCP's initialize answer (vau mcp asks for them here). Each line comes from a plugin's manifest (`forAgents`), so turning a plugin off takes its line out.\n\n  vau mcp.instructions",
  kind: "read",
  run: () => ({ text: instructions() }),
  text: (r) => r.text,
})

/** The server for one request: the catalog as it is now, tools run for that request. */
const serverFor = (http: Request["http"]) => ({
  version: APP_VERSION,
  instructions,
  ctx: (client: Client, tool: string) => ctxFor({ ...client, client: client.client ?? "mcp" }, tool, http),
  tools: () => toolsOf(plugin.host.catalog()),
  apps,
  appUrl,
})

plugin.route("POST", "mcp", async (req) => {
  await allowed(req)
  const sid = String(req.http?.headers["mcp-session-id"] ?? "")
  const session: Session = { ...sessions.get(sid) ?? { client: null } }
  const body = req.body as unknown
  const out = await handleBody(body, session, serverFor(req.http))
  const headers: Record<string, string> = {}
  if (initializes(body)) {
    const id = crypto.randomUUID()
    sessions.set(id, session)
    while (sessions.size > 200) sessions.delete(sessions.keys().next().value!)
    headers["Mcp-Session-Id"] = id
  }
  if (out === null) return reply(202, new Text("", "text/plain; charset=utf-8", headers))
  return new Text(JSON.stringify(out), "application/json", headers)
}, { lock: false })

plugin.route("GET", "mcp", async (req) => {
  await allowed(req)
  return reply(405, new Text("This MCP server answers POSTs only: it has no stream of its own messages.", "text/plain; charset=utf-8", { Allow: "POST, DELETE" }))
}, { lock: false })

plugin.route("DELETE", "mcp", async (req) => {
  await allowed(req)
  sessions.delete(String(req.http?.headers["mcp-session-id"] ?? ""))
  return { ok: true }
}, { lock: false })

/** A tool by name for another plugin's route (one that doesn't hold the vault), as `client`, for request `req`: its
 *  Markdown answer, or an OpError/ToolError saying why not. */
plugin.provide("mcp:tool", async (req: Request | null, name: string, args: Record<string, unknown>, client: { agent: string; label: string; source: string }) => {
  const who: Who = { client: "mcp", agent: client.agent, label: client.label, source: client.source }
  const tool = toolsOf(plugin.host.catalog()).find((t) => t.name === name)
  if (!tool) throw new ToolError(`no tool ${name}`)
  const out = await tool.run(args, ctxFor(who, name, req?.http))
  return typeof out === "string" ? out : out.text
})

const toolNamed = async (name: string) => (await toolsWithApps({ tools: () => toolsOf(plugin.host.catalog()), apps })).find((x) => x.name === name)
/** For a host drawing cards in the app (a plugin's block): a tool as tools/list declares it, its CallToolResult run as
 *  the request's caller (an in-app op's checks), and a card's resources/read with its page's CSP. */
plugin.provide("mcp:app-host", () => ({
  tool: async (name: string) => {
    const t = await toolNamed(name)
    return t ? { declared: declared(t), kind: plugin.host.catalog().find((e) => e.mcp === name)?.kind ?? null } : null
  },
  call: async (req: Request, name: string, args: Record<string, unknown>) => {
    const t = await toolNamed(name)
    if (!t) throw new OpError(`no tool ${name}`, 404)
    return callTool(t, args, { client: { agent: null, label: "", source: "" }, op: (id, params) => plugin.host.call(id, params, undefined, { http: req.http }) }, appUrl())
  },
  read: async (uri: string) => {
    const a = (await apps()).find((x) => x.uri === uri)
    return a ? { ...(await contents(a)), csp: cspOf(a.meta) } : null
  },
}))

/** MCP on the internet (public.ts): its own listener when this machine's data/config.json has its address, or for Vaultite
 *  Cloud (cloud.ts) once signed in, on any free port. */
const settings = PublicMcp.settingsOf(plugin)
let pub: PublicMcp | null = null
function publicMcp() {
  if (!pub) {
    pub = new PublicMcp(plugin, settings ?? PublicMcp.cloudOnly())
    pub.cloudUrl = () => cloud.stored()?.url.replace(/\/+$/, "") ?? null
    pub.appUrl = appUrl
    pub.connect = { key: () => cloud.connectKey, handle: () => cloud.stored()?.handle ?? null, ownerTools }
    pub.start()
  }
  return pub
}
const cloud = new Cloud(plugin, () => publicMcp().ready)
/** Connect: whether terminals, coding agents and the like answer the owner over the relay (data/config.json, this Mac's). */
const ownerTools = () => (plugin.secrets().mcp as { connect?: { ownerTools?: boolean } } | undefined)?.connect?.ownerTools === true
let signedIn = false
cloud.onChange = (s) => {
  // Told once signed in, and when it stops on its own (revoked, another machine): not every reconnect.
  const text = s.state === "connected" && signedIn ? `Your vault's MCP server is at ${s.url}` : s.state === "replaced" || (s.state === "off" && s.message) ? s.message : ""
  if (s.state !== "connecting") signedIn = false
  if (text) try { void plugin.runOp("ui.notify", { text, actionOpen: "view:connections" }).catch(() => {}) } catch { /* still starting */ }
}
if (settings || cloud.stored()) publicMcp()

/** A one-time link an internet app's sandbox PUTs a file's bytes to (file.upload without the file), or null when the
 *  vault isn't on the internet. */
plugin.provide("mcp:upload-link", (pending: Record<string, unknown>, who: Who) => pub?.uploadLink(pending, who) ?? null)
cloud.start()
plugin.onUnload(() => { pub?.stop(); cloud.stop() })

/** The apps connected from the internet, the sign-ins waiting for their code (how many, and their apps), those finishing
 *  and those that failed lately, and Vaultite Cloud. */
plugin.route("GET", "mcp/connections", async (req) => {
  await allowed(req)
  return { url: settings ? `${settings.url}/mcp` : null, cloud: cloud.status(), connect: { ownerTools: ownerTools() }, connections: pub?.list() ?? [],
    waiting: pub?.waiting() ?? 0, asking: pub?.asking() ?? [], finishing: pub?.finishing() ?? [], failed: pub?.failures() ?? [] }
}, { lock: false })

/** Connect's owner tools on or off: only from this Mac (or the owner's tailnet), never over the relay itself. */
plugin.route("POST", "mcp/connect", async (req) => {
  await allowed(req)
  await plugin.ownerOnly(req, "Changing what answers over Vaultite Connect")
  const on = (req.body as { ownerTools?: unknown })?.ownerTools === true
  const all = structuredClone((plugin.secrets().mcp ?? {}) as Record<string, unknown>)
  const c = { ...(all.connect as object | undefined) } as Record<string, unknown>
  if (on) c.ownerTools = true; else delete c.ownerTools
  if (Object.keys(c).length) all.connect = c; else delete all.connect
  plugin.saveSecrets(all)
  return { ownerTools: on }
}, { lock: false })

/** Let in the app whose sign-in page shows this code. */
plugin.route("POST", "mcp/connections", async (req) => {
  await allowed(req)
  if (!pub) throw new HTTPError(404, "MCP isn't on the internet here: sign in to Vaultite Cloud, or set mcp.public.url in data/config.json")
  const b = (req.body ?? {}) as { code?: unknown; as?: unknown }
  const name = pub.approve(String(b.code ?? ""), typeof b.as === "string" && b.as.trim() ? b.as.trim() : undefined)
  if (!name) throw new HTTPError(404, "No sign-in waits with that code: check it, or start again from the app (a code lasts 10 minutes)")
  return { ok: true, name }
}, { lock: false })

/** Rename a connection (Activity names it so after) or set its access: `read` or `write`. The owner's only (allowed). */
plugin.route("PATCH", "mcp/connections/*", async (req) => {
  await allowed(req)
  const b = (req.body ?? {}) as { name?: unknown; access?: unknown }
  const name = typeof b.name === "string" ? b.name.trim() : undefined
  if (b.name !== undefined && !name) throw new HTTPError(400, "name: what to call the app")
  if (b.access !== undefined && b.access !== "read" && b.access !== "write") throw new HTTPError(400, "access: read or write")
  if (!pub?.update(req.arg(0), { name, access: b.access as "read" | "write" | undefined })) throw new HTTPError(404, "no such connection")
  return { ok: true }
}, { lock: false })

plugin.route("DELETE", "mcp/connections/*", async (req) => {
  await allowed(req)
  if (!pub?.disconnect(req.arg(0))) throw new HTTPError(404, "no such connection")
  return { ok: true }
}, { lock: false })

// ---------- Vaultite Cloud's operations (vau cloud, the Connections view, onboarding)

const CLOUD = "Vaultite Cloud's sign-in"

function cloudText(s: CloudStatus) {
  const why = s.message ? ` (${s.message})` : ""
  switch (s.state) {
    case "off": return `Not signed in to Vaultite Cloud${why}. To sign in, open ${s.connectUrl}, sign in there, and type the code it shows: vau cloud sign-in <code>`
    case "connected": return `Connected. Add ${s.url} as a custom connector in claude.ai or ChatGPT; its sign-in page shows a code to type in Connections.${s.app ? ` The phone and any browser reach this Mac's app at ${s.app} while it's on (signed in with the Vaultite account).` : ""}`
    case "replaced": return `Signed in as ${s.handle}, but another machine took over the address (${s.message}). Use this machine again: vau cloud sign-in`
    default: return `Signed in as ${s.handle} (${s.url}): ${s.state}${why}.`
  }
}

const statusResult = { type: "object" as const, description: "state (off, connecting, connected, reconnecting, offline, replaced), handle, url (the MCP address), app (where the owner opens the app from anywhere), connectUrl (where to get a code), message" }

plugin.op({
  id: "mcp.cloud-status",
  cli: "cloud",
  owner: CLOUD,
  summary: "Vaultite Cloud on this machine: signed in or not, its MCP address (https://<handle>.vaultite.app/mcp), and the tunnel's state.",
  help: `Vaultite Cloud puts the vault's MCP server for apps on the internet (claude.ai, ChatGPT) at an address of its own,
with no tunnel to set up. Signed out, where to get a code to sign in with.

  vau cloud`,
  kind: "read",
  result: statusResult,
  run: () => cloud.status(),
  text: cloudText,
})

plugin.op({
  id: "mcp.cloud-sign-in",
  cli: "cloud sign-in",
  owner: CLOUD,
  summary: "Sign this machine in to Vaultite Cloud with the one-time code from its /connect page; it connects at once.",
  help: `The user opens https://cloud.vaultite.com/connect, signs in (Google or GitHub), picks their address and gets a code
(XXXX-XXXX, 10 minutes, once) to type here; the machine then keeps a tunnel open and the vault's MCP server answers at
https://<handle>.vaultite.app/mcp. It replaces the machine signed in before. Never use a code someone else gave you: it
connects this machine to their account. Without a code: signed out, where to get one; signed in, connects this machine again
(after another took over).

  vau cloud sign-in BCDF-GHJK`,
  kind: "write",
  lock: false, // talks to Vaultite Cloud, holds nothing of the vault
  params: { code: { type: "string", description: "the code /connect shows (XXXX-XXXX)" } },
  args: ["code"],
  result: statusResult,
  run: async ({ code }) => {
    publicMcp()
    if (code?.trim()) signedIn = true
    try { return await cloud.signIn(code ?? "") } catch (e) {
      signedIn = false
      const status = (e as { status?: number }).status
      if (status === 400) throw new OpError(`That code doesn't work: it may be mistyped, used or older than 10 minutes. Get a new one at ${cloud.status().connectUrl}`, 400)
      if (status === 429) throw new OpError("Too many tries: wait a minute and try again", 429)
      throw new OpError(`Couldn't reach Vaultite Cloud: ${(e as Error).message}`, 502)
    }
  },
  text: cloudText,
})

plugin.op({
  id: "mcp.cloud-sign-out",
  cli: "cloud sign-out",
  owner: CLOUD,
  summary: "Sign this machine out of Vaultite Cloud: the tunnel closes and its address stops answering here.",
  help: `Ends this machine's sign-in on Vaultite Cloud too, and forgets it here (even when Vaultite Cloud can't be reached). Apps
connected through it stay in Connections until disconnected there.

  vau cloud sign-out`,
  kind: "destructive",
  lock: false,
  result: statusResult,
  run: () => cloud.signOut(),
  text: cloudText,
})
