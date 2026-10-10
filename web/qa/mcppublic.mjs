// MCP on the internet (plugins/core/mcp/public.ts), as an app like claude.ai uses it: discovery, registration, the
// sign-in page and its code, the owner letting it in (POST /api/mcp/connections), the token exchange with PKCE, MCP with
// the token (every tool but the owner's, dispatch only with their yes, and gated calls waiting for the owner's yes), a refresh, and a disconnect ending it. Also what it refuses: an app returning
// elsewhere, a wrong code or verifier, no token, an owner-only route through it. Starts its own server on a copy of the
// vault (the public listener needs this machine's data/config.json), so it WRITES only there. No browser.
//   node web/qa/mcppublic.mjs <vault copy>
import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, qa, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })

const local = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-mcppublic-"))
const port = await freePort(), pubPort = await freePort()
const PUB = `http://127.0.0.1:${pubPort}`, BASE = `http://127.0.0.1:${port}`
const REDIRECT = "https://app.example.com/callback"
fs.writeFileSync(path.join(local, "config.json"), JSON.stringify({ mcp: { public: { url: PUB, port: pubPort, redirectHosts: ["app.example.com"], approvalWait: 3 } } }))
const proc = spawn(process.execPath, [path.join(ROOT, "server.ts")], { cwd: ROOT, stdio: "ignore",
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: local } })
const stop = () => {
  if (proc.exitCode === null) proc.kill()
  try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  fs.rmSync(local, { recursive: true, force: true })
}

try {
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`${PUB}/`)).ok) break } catch { await wait(250) } }
  const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers })

  // Discovery: /mcp says where to sign in.
  const unauth = await fetch(`${PUB}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  check("no token: 401 naming the resource metadata", unauth.status === 401 && /resource_metadata="[^"]+oauth-protected-resource"/.test(unauth.headers.get("www-authenticate") ?? ""), unauth.status)
  const prm = await json(await fetch(`${PUB}/.well-known/oauth-protected-resource`))
  check("protected resource metadata", prm.body?.resource === `${PUB}/mcp` && prm.body?.authorization_servers?.[0] === PUB, prm.body)
  const asm = await json(await fetch(`${PUB}/.well-known/oauth-authorization-server`))
  check("authorization server metadata (S256, registration)", asm.body?.code_challenge_methods_supported?.includes("S256") && asm.body?.registration_endpoint === `${PUB}/register`, asm.body)
  check("nothing else of the app is served", (await fetch(`${PUB}/api/state`)).status === 404 && (await fetch(`${PUB}/api/mcp/connections`)).status === 404)

  // Registration: only apps that return to an allowed host.
  const evil = await json(await fetch(`${PUB}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Evil", redirect_uris: ["https://evil.example.net/cb"] }) }))
  check("registration refuses another return address", evil.status === 400, evil)
  const loop = await json(await fetch(`${PUB}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Desk", redirect_uris: ["http://localhost:8787/callback"] }) }))
  const lan = await json(await fetch(`${PUB}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Lan", redirect_uris: ["http://192.168.1.9:8787/callback"] }) }))
  check("a desktop app's loopback return address is let in, another plain http one isn't", loop.status === 201 && lan.status === 400, [loop, lan])
  const reg = await json(await fetch(`${PUB}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Lighthouse AI", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) }))
  const clientId = reg.body?.client_id
  check("registration", reg.status === 201 && clientId && reg.body.token_endpoint_auth_method === "none", reg)

  // The sign-in page and its code.
  const verifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
  const auth = (q) => fetch(`${PUB}/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", ...q })}`, { redirect: "manual" })
  check("authorize refuses an unregistered return address", (await auth({ redirect_uri: "https://app.example.com/other" })).status === 400)
  const noPkce = await auth({ code_challenge_method: "plain" })
  check("authorize without S256 goes back with an error", noPkce.status === 302 && /error=invalid_request/.test(noPkce.headers.get("location") ?? ""), noPkce.status)
  const page = await (await auth({})).text()
  const code = /<div class="code"[^>]*>([^<]+)</.exec(page)?.[1]?.replace(/\s/g, "")
  const id = /const id = "([^"]+)"/.exec(page)?.[1]
  check("the sign-in page shows a code", code?.length === 6 && !!id, page.slice(0, 300))
  const st = async () => (await json(await fetch(`${PUB}/authorize/status?id=${encodeURIComponent(id)}`))).body
  check("it waits for the owner", (await st())?.state === "waiting")

  // The owner lets it in, from this machine (the app's server, not the public listener).
  const wrong = await fetch(`${BASE}/api/mcp/connections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "BBBBBB" }) })
  check("a wrong code lets nothing in", wrong.status === 404, wrong.status)
  const proxied = await fetch(`${BASE}/api/mcp/connections`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ code }) })
  check("only the owner may let an app in", proxied.status === 403, proxied.status)
  const ok = await json(await fetch(`${BASE}/api/mcp/connections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.toLowerCase().replace(/(...)/, "$1 ") }) }))
  check("the owner types the code", ok.status === 200 && ok.body?.name === "Lighthouse AI", ok)
  const done = await st()
  const back = new URL(done?.to ?? "https://x.invalid/")
  check("the page goes back to the app with a code and its state", done?.state === "approved" && back.origin + back.pathname === REDIRECT && back.searchParams.get("state") === "xyz" && !!back.searchParams.get("code"), done)

  // Tokens.
  const token = (fields) => fetch(`${PUB}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) }).then(json)
  const authCode = back.searchParams.get("code")
  const bad = await token({ grant_type: "authorization_code", code: authCode, client_id: clientId, redirect_uri: REDIRECT, code_verifier: "not-it" })
  check("a wrong verifier gets no token (and spends the code)", bad.status === 400 && bad.body?.error === "invalid_grant", bad.body)
  // Again, with a fresh sign-in, the right way.
  const page2 = await (await auth({})).text()
  const code2 = /<div class="code"[^>]*>([^<]+)</.exec(page2)?.[1]?.replace(/\s/g, "")
  const id2 = /const id = "([^"]+)"/.exec(page2)?.[1]
  await fetch(`${BASE}/api/mcp/connections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code2, as: "Lighthouse Desk" }) })
  const finishing = async () => (await json(await fetch(`${BASE}/api/mcp/connections`))).body?.finishing
  const f1 = await finishing()
  check("let in from its app's sheet, it's finishing under that app's name (a row till it's connected)", f1?.length === 1 && f1[0] === "Lighthouse Desk", f1)
  const to2 = new URL((await (await fetch(`${PUB}/authorize/status?id=${encodeURIComponent(id2)}`)).json()).to)
  const f2 = await finishing()
  check("… still, taken back to the app with its code", f2?.length === 1, f2)
  const tok = await token({ grant_type: "authorization_code", code: to2.searchParams.get("code"), client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier })
  check("the code and verifier get tokens", tok.status === 200 && tok.body?.access_token && tok.body?.refresh_token && tok.body?.token_type === "Bearer", tok.body)
  const f3 = await finishing()
  check("… and it's no longer finishing", f3?.length === 0, f3)
  const again = await token({ grant_type: "authorization_code", code: to2.searchParams.get("code"), client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier })
  check("a code works once", again.status === 400, again.body)

  // MCP with the token.
  let sid = null, n = 0
  const rpc = async (method, params, access = tok.body.access_token, extra = {}) => {
    const r = await fetch(`${PUB}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${access}`, ...(sid ? { "Mcp-Session-Id": sid } : {}), ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) })
    sid = r.headers.get("mcp-session-id") ?? sid
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "lighthouse" }, capabilities: {} })
  check("initialize", init.status === 200 && init.body?.result?.serverInfo?.name === "vaultite" && /ops lists the rest/.test(init.body.result.instructions) && /waits for their yes/.test(init.body.result.instructions), init.body)
  const icons = init.body?.result?.serverInfo?.icons ?? []
  check("serverInfo has the logo, a PNG first (hosts that draw no SVG)", icons[0]?.src === `${PUB}/icon.png` && icons[0]?.mimeType === "image/png" && icons[1]?.src === `${PUB}/icon.svg`, icons)
  const icon = await fetch(`${PUB}/icon.svg`), png = await fetch(`${PUB}/icon.png`)
  check("the logo is served", icon.status === 200 && (icon.headers.get("content-type") ?? "").includes("svg") && png.status === 200 && png.headers.get("content-type") === "image/png", [icon.status, png.status])
  const tools = (await rpc("tools/list", {})).body?.result?.tools?.map((t) => t.name) ?? []
  check("the full catalog: named tools, ops and call, without the owner's", tools.includes("search") && tools.includes("write_note") && tools.includes("today") && tools.includes("call") && tools.includes("ops"), tools)
  const opsList = await rpc("tools/call", { name: "ops", arguments: {} })
  check("ops lists no owner-only operation", !opsList.body?.result?.isError && opsList.body.result.content[0].text.includes("note.create") && !opsList.body.result.content[0].text.includes("terminal.send"), opsList.body)
  const term = await rpc("tools/call", { name: "call", arguments: { id: "terminal.list" } })
  check("an owner-only op through call is refused", term.body?.result?.isError === true, term.body)
  // Forged headers (what a tunnel passes on): Tailscale Serve's login, one the terminal lets in, and the app's own.
  fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/terminal"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/terminal/data.json"), JSON.stringify({ allowUsers: ["alice@example.com"] }))
  const forgedHeaders = { "Tailscale-User-Login": "alice@example.com", "Tailscale-User-Name": "Alice Park", "X-Vaultite-Client": "app" }
  for (const id of ["terminal.list", "terminal"]) {
    const r = await rpc("tools/call", { name: "call", arguments: { id } }, undefined, forgedHeaders)
    check(`a forged Tailscale login can't run an owner op (${id})`, r.body?.result?.isError === true, r.body)
  }
  const byName = await rpc("tools/call", { name: "call", arguments: { id: "plugin on", params: { id: "qa-gate" } } })
  check("a gated op called by its CLI name waits too", byName.body?.result?.isError === true && /Waiting for the user's yes/.test(byName.body.result.content[0].text), byName.body)
  for (const e of (await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.filter((e) => e.gate && !e.answer) ?? []) {
    await fetch(`${BASE}/api/inbox/events/${encodeURIComponent(e.id)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "deny" }) })
  }
  const docs = await rpc("tools/call", { name: "call", arguments: { id: "docs.list" } })
  check("call runs an ungated op at once", docs.body?.result?.isError === false && docs.body.result.content[0].text.includes("api"), docs.body)
  // A gated call: it waits (the server is started with a short wait), asks through the inbox, and runs once approved.
  const note = `hi${" there".repeat(500)}` // (longer than any cut: the owner reads all of it)
  const gatedArgs = { name: "call", arguments: { id: "settings.set", params: { name: "plugin/qa-gate", values: { note } } } }
  const gatedFile = path.join(VAULT, ".vaultite/plugins/qa-gate/data.json")
  const gated = await rpc("tools/call", gatedArgs)
  check("settings wait for the owner's yes", gated.body?.result?.isError === true && /Waiting for the user's yes/.test(gated.body.result.content[0].text) && !fs.existsSync(gatedFile), gated.body)
  const asks = (await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.filter((e) => e.gate && !e.answer) ?? []
  check("it asks in the inbox, as a permission", asks.length === 1 && asks[0].ask === "permission" && asks[0].title.includes("Lighthouse Desk"), asks)
  check("it asks with the parameters whole, one per line", asks[0]?.body?.includes(`"note": "${note}"`), asks[0]?.body?.slice(-200))
  const selfApprove = await rpc("tools/call", { name: "call", arguments: { id: "inbox.answer", params: { id: asks[0]?.id, answer: "approve" } } })
  check("the app can't approve itself", selfApprove.body?.result?.isError === true, selfApprove.body)
  const askedAgain = await rpc("tools/call", gatedArgs)
  check("asked again, it doesn't ask twice", askedAgain.body?.result?.isError === true && ((await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.filter((e) => e.gate && e.title.includes("settings")).length === 1), askedAgain.body)
  const yes = await json(await fetch(`${BASE}/api/ops/inbox.answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asks[0]?.id, answer: "approve" }) }))
  check("the owner approves (inbox.answer)", yes.status === 200, yes)
  const ran = await rpc("tools/call", gatedArgs)
  check("called again once approved, it runs", ran.body?.result?.isError === false && JSON.parse(fs.readFileSync(gatedFile, "utf8")).note === note, ran.body)
  const twice = await rpc("tools/call", gatedArgs)
  check("a yes is for one call", twice.body?.result?.isError === true && /Waiting/.test(twice.body.result.content[0].text), twice.body)
  const ask2 = (await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.find((e) => e.gate && !e.answer)
  const pending = rpc("tools/call", { name: "call", arguments: { id: "plugin.enable", params: { id: "qa-gate" } } })
  await wait(300)
  const ask3 = (await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.find((e) => e.gate && !e.answer && e.title.includes("turn on a plugin"))
  await fetch(`${BASE}/api/inbox/events/${encodeURIComponent(ask3?.id ?? "x")}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "deny" }) })
  const denied = await pending
  check("a call waiting for its answer hears a no at once", denied.body?.result?.isError === true && /said no/.test(denied.body.result.content[0].text), denied.body)
  // Dispatch: the owner's op an app may ask for. A file that isn't there, so no agent starts: past the gate, the op says so.
  const dispatchArgs = { name: "call", arguments: { id: "dispatch.run", params: { path: "Notes/QA nowhere.md" } } }
  const listedOps = await rpc("tools/call", { name: "ops", arguments: { filter: "dispatch" } })
  check("ops offers dispatch.run", listedOps.body?.result?.content?.[0]?.text?.includes("dispatch.run"), listedOps.body)
  const waiting = await rpc("tools/call", dispatchArgs)
  check("dispatch.run waits for the owner's yes", waiting.body?.result?.isError === true && /Waiting/.test(waiting.body.result.content[0].text), waiting.body)
  const askD = (await json(await fetch(`${BASE}/api/inbox/events`))).body?.events?.find((e) => e.gate && !e.answer && e.title.includes("coding agent"))
  await fetch(`${BASE}/api/inbox/events/${encodeURIComponent(askD?.id ?? "x")}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "approve" }) })
  const dispatched = await rpc("tools/call", dispatchArgs)
  check("approved, it runs as the owner's (the op itself answers, not the owner check)", !!askD && dispatched.body?.result?.isError === true && /there's no file/.test(dispatched.body.result.content[0].text), dispatched.body)
  const otherOwner = await rpc("tools/call", { name: "call", arguments: { id: "terminal.send", params: { id: "x", text: "ls" } } })
  check("other owner ops stay refused", otherOwner.body?.result?.isError === true && /only for this machine's owner/.test(otherOwner.body.result.content[0].text), otherOwner.body)
  check("clipping a local address is gated", (await rpc("tools/call", { name: "clip", arguments: { url: "http://127.0.0.1:8793/api/state" } })).body?.result?.content?.[0]?.text?.includes("Waiting") && !!ask2)
  const search = await rpc("tools/call", { name: "search", arguments: { query: "Alice" } })
  check("a tool runs", search.body?.result?.isError === false, search.body)
  const wrote = await rpc("tools/call", { name: "write_note", arguments: { title: "From the internet", body: "Written through the public MCP." } })
  check("a write runs", wrote.body?.result?.isError === false, wrote.body)
  const fm = fs.readFileSync(path.join(VAULT, "Notes/From the internet.md"), "utf8").split("\n---")[0]
  check("it's named as the app signed in, not its MCP client's name", /lighthouse-desk/i.test(fm) && !/^source: lighthouse$/m.test(fm), fm)
  // A photo from an app whose sandbox can PUT (claude.ai's): a one-time link, then the bytes, embedded in the note.
  const linked = await rpc("tools/call", { name: "upload_file", arguments: { name: "Lunch", note: "Notes/From the internet.md" } })
  const link = /PUT the file's bytes to (\S+),/.exec(linked.body?.result?.content?.[0]?.text ?? "")?.[1]
  check("upload_file without the file answers a one-time link on the public address", linked.body?.result?.isError === false && link?.startsWith(`${PUB}/upload/`), linked.body)
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)])
  const put = await json(await fetch(link, { method: "PUT", body: jpeg }))
  check("PUT to it saves the bytes as an attachment, embedded in the note", put.status === 201 && put.body?.path === "Attachments/Lunch.jpg"
    && fs.readFileSync(path.join(VAULT, "Attachments/Lunch.jpg")).equals(jpeg) && fs.readFileSync(path.join(VAULT, "Notes/From the internet.md"), "utf8").includes("![[Lunch.jpg]]"), put.body)
  check("the link works once", (await fetch(link, { method: "PUT", body: jpeg })).status === 404)
  check("a made-up link does nothing", (await fetch(`${PUB}/upload/nope`, { method: "PUT", body: jpeg })).status === 404)
  // A big file: through a link, any size (streamed); in a tool call, over this server's body limit, told to use a link.
  const linked2 = await rpc("tools/call", { name: "upload_file", arguments: { name: "Scan.pdf" } })
  const link2 = /PUT the file's bytes to (\S+),/.exec(linked2.body?.result?.content?.[0]?.text ?? "")?.[1]
  const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40 << 20, 7)])
  const put2 = await json(await fetch(link2, { method: "PUT", body: big }))
  check("a 40 MB file through a link is saved whole", put2.status === 201 && fs.statSync(path.join(VAULT, put2.body?.path ?? "none")).size === big.length, put2.body)
  const tooBig = await rpc("tools/call", { name: "upload_file", arguments: { name: "Scan 2.pdf", data: big.subarray(0, 5 << 20).toString("base64") } })
  check("a tool call over the body limit says to use an upload link", tooBig.status === 413 && /upload link/.test(tooBig.body?.error?.message ?? ""), [tooBig.status, tooBig.body])
  const forged = await rpc("tools/list", {}, `${tok.body.access_token.split(".")[0]}.AAAA`)
  check("a forged token is refused", forged.status === 401, forged.status)

  // Refresh, then disconnect.
  const ref = await token({ grant_type: "refresh_token", refresh_token: tok.body.refresh_token, client_id: clientId })
  check("a refresh gets new tokens", ref.status === 200 && ref.body?.refresh_token && ref.body.refresh_token !== tok.body.refresh_token, ref.body)
  const list = await json(await fetch(`${BASE}/api/mcp/connections`))
  const conn = list.body?.connections?.find((c) => c.name === "Lighthouse Desk")
  check("the owner sees the connection", !!conn && list.body.url === `${PUB}/mcp`, list.body)
  check("the public listener never shows the connections", (await fetch(`${PUB}/api/mcp/connections`)).status === 404)
  await fetch(`${BASE}/api/mcp/connections/${encodeURIComponent(conn?.id ?? "x")}`, { method: "DELETE" })
  const after = await rpc("tools/list", {}, ref.body?.access_token)
  check("disconnecting ends its access token", after.status === 401, after.status)
  const ref2 = await token({ grant_type: "refresh_token", refresh_token: ref.body?.refresh_token, client_id: clientId })
  check("and its refresh token", ref2.status === 400, ref2.body)
  check("no secret in the vault", !fs.readdirSync(path.join(VAULT, ".vaultite"), { recursive: true }).map(String).some((f) => { try { return /refresh|"key"/.test(fs.readFileSync(path.join(VAULT, ".vaultite", f), "utf8")) && f.includes("mcp") } catch { return false } }))
} finally {
  stop()
}
await done()
