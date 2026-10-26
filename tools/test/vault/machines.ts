import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, clearWs, read, readWs, write } = $
  // Machines: the list from the settings, each asked what it is; another machine's API through this one (GET only).
  {
    const seen: string[] = []
    const peer = (await import("node:http")).createServer((req, res) => {
      seen.push(`${req.url} ${req.headers["x-vaultite-client"]}`)
      const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
      if (req.url === "/api/machines/self") return json(200, { instance: "peer-1", host: "box", platform: "linux", version: "0.1.0", commit: "abc1234", plugins: ["terminal", "harbor"],
        vault: JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/machines/vault.json"), "utf8")).id })
      if (req.url?.startsWith("/api/harbor/tides")) return json(200, [{ at: "06:10", label: "High" }])
      if (req.url?.startsWith("/api/raw?")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<script>parent.x = 1</script>") }
      if (req.url === "/api/claude-code/session/a%20b?limit=2") return json(200, { id: "a b" })
      if (req.url?.startsWith("/api/render/block?")) {
        const q = new URL(req.url, "http://x").searchParams
        res.writeHead(200, { "Content-Type": "text/markdown" })
        return res.end(`## From box: ${q.get("name")} ${q.get("path")} ${q.get("options")}`)
      }
      json(404, { error: "no such thing" })
    })
    await new Promise<void>((r) => peer.listen(0, "127.0.0.1", () => r()))
    const port = (peer.address() as { port: number }).port
    write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [
      { id: "box", label: "Box", url: `http://127.0.0.1:${port}/` }, { id: "gone", url: "http://127.0.0.1:9" }, { id: "Not ok!", url: "x" }, { id: "box", url: "http://other" },
    ] }))
    let [c, ms] = await api("GET", "machines")
    const box = ms.find?.((m: Any) => m.id === "box"), gone = ms.find?.((m: Any) => m.id === "gone")
    check("machines: the listed ones (a usable id and url, each id once), each asked what it is", c === 200 && ms.length === 2 &&
      box?.online && box.label === "Box" && box.host === "box" && box.platform === "linux" && box.commit === "abc1234" && !box.self &&
      box.plugins.includes("terminal") && gone && !gone.online && gone.label === "gone" && gone.error, ms)
    check("machines: asked as a machine", seen.some((x) => x.startsWith("/api/machines/self machine/")), seen)
    const vid = JSON.parse(read(".vaultite/plugins/machines/vault.json")).id
    check("machines: this vault's id, made once, and each machine's", /^[\w-]{36}$/.test(vid) && box?.vault === vid, [vid, box?.vault])
    const [, me] = await api("GET", "machines/self")
    check("machines: what this one says of itself", typeof me.instance === "string" && me.host && me.version && me.plugins.includes("machines"), me)
    let body: Any
    ;[c, body] = await api("GET", "machines/box/harbor/tides")
    check("machines: another machine's API through this one", c === 200 && JSON.parse(String(body))[0].label === "High", [c, body])
    ;[c, body] = await api("GET", "machines/box/claude-code/session/a b?limit=2")
    check("machines: its path encoded and its query kept", c === 200 && JSON.parse(String(body)).id === "a b", [c, body, seen.at(-1)])
    const page0 = await app.run("GET", ["machines", "box", "raw"], { path: "x.html" }, {})
    const h0 = (page0.body as Any)?.headers ?? {}
    check("machines: another machine's page or picture never runs here (sandboxed, as sent)", page0.status === 200 && /^sandbox/.test(h0["Content-Security-Policy"] ?? "") && h0["X-Content-Type-Options"] === "nosniff", [page0.status, h0])
    {
      // (the list is a vault file, and the server asks a machine as its owner: only the owner, only the tailnet)
      const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
      const r = await app.run("GET", ["machines", "box", "harbor", "tides"], {}, {}, stranger)
      const { onTailnet } = await import("../../../plugins/core/machines/plugin.ts")
      check("machines: another machine's API only for this one's owner", r.status === 403, r.status)
      check("machines: only addresses on the tailnet (or this machine's)", ["https://studio.tail1234.ts.net:8447", "http://100.101.2.3:8793", "http://127.0.0.1:8794", "http://[fd7a:115c:a1e0::1]:8793"].every(onTailnet) &&
        !["https://evil.example.com", "http://192.168.1.5", "http://100.200.1.1", "https://ts.net.evil.example", "https://a@studio.tail1234.ts.net", "file:///etc"].some(onTailnet))
    }
    {
      // (other machines ask it who it is: a machine with Machines off is still one, the mini PC's case)
      const owner = { headers: { host: "127.0.0.1:8793" }, socket: { remoteAddress: "127.0.0.1" } } as Any
      const conf = app.vault.config("plugins")
      await api("PUT", "config/plugins", { ...conf, enabled: (conf.enabled ?? []).filter((x: string) => x !== "machines") })
      const off = await app.run("GET", ["machines", "self"], {}, {}, owner)
      await api("PUT", "config/plugins", conf)
      check("machines: off, it still says who it is to other machines", off.status === 200, off.status)
    }
    ;[c, body] = await api("GET", "machines/box/nothing")
    check("machines: its errors come back as they are", c === 404 && body.error === "no such thing", [c, body])
    ;[c] = await api("GET", "machines/nope/state")
    check("machines: an unknown machine is a 404", c === 404, c)
    ;[c] = await api("GET", "machines/gone/state")
    check("machines: one that doesn't answer is a 502", c === 502, c)
    ;[c] = await api("POST", "machines/box/notes", {})
    check("machines: only GET goes through", c !== 200, c)
    write("Dashboards/Qa machines list.md", "---\ntype: dashboard\n---\n\n```block-machines\n```\n")
    const [, text] = await api("GET", "render?path=Dashboards/Qa machines list.md")
    check("machines: its block as text", String(text).includes("Box: online, box"), String(text).slice(0, 300))
    write("Dashboards/Qa machines.md", "---\ntype: dashboard\n---\n\n```block-agent-sessions\nagent: claude-code\nmachine: box\nrecent: 2\n```\n\n```block-agent-sessions\nagent: claude-code\nmachine: gone\n```\n\n```block-agent-sessions\nagent: claude-code\nmachine: nope\n```\n")
    const [, page] = await api("GET", "render?path=Dashboards/Qa machines.md")
    check("machines: a block with machine: is drawn by that machine (its options without machine:)",
      String(page).includes('## From box: agent-sessions Dashboards/Qa machines.md {"agent":"claude-code","recent":2}') && String(page).includes("_(gone isn't answering)_") &&
      String(page).includes("_(no machine nope)_"), page)
    // (this test's api() passes the query as it's written: the server decodes it)
    const [c2, one] = await api("GET", 'render/block?name=agent-sessions&path=Dashboards/Qa machines.md&options={"agent":"claude-code","recent":1,"machine":"box"}')
    check("machines: one block drawn here for another machine, never passed on", c2 === 200 && String(one).startsWith("## Claude Code sessions"), [c2, String(one).slice(0, 100)])
    fs.rmSync(path.join(VAULT, "Dashboards/Qa machines.md"))
    peer.close()
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/vault.json"))
    {
      const join = app.plugins.find((x: Any) => x.id === "machines")!.exports.join
      const conf = () => JSON.parse(read(".vaultite/plugins/machines/data.json"))
      join("https://here.example.ts.net")
      const one = conf()
      join("https://here.example.ts.net")
      check("machines: this one adds itself once", one.machines.length === 1 && one.added.length === 1 && JSON.stringify(conf()) === JSON.stringify(one), one)
      write(".vaultite/plugins/machines/data.json", JSON.stringify({ ...one, machines: [] }))
      join("https://here.example.ts.net")
      check("machines: removed by the user, it stays removed", conf().machines.length === 0, conf())
      fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
    }
  }

  // Terminal tabs on several machines: saved with their shell's machine (`<id>@<machine>`), shown to each app as its own
  // or the other's; a vault without machines unchanged.
  {
    const { service } = await import("../../../core/plugins.ts")
    const tabsOf = (l: Any) => (l.root.tabs as Any[]).map((t) => t.to).join()
    const layout = (...tos: string[]) => ({ root: { id: "g0", tabs: tos.map((to, i) => ({ id: `t${i}`, to })), active: "t0" }, focus: "g0" })
    write("Notes/Qa host.md", "Host.\n")
    // No machines: nothing changes.
    let [st, body] = await api("PUT", "workspaces/1", { layout: layout("view:terminal/qaone1", "file:Notes/Qa host.md") })
    check("terminal machines: without machines a terminal tab is saved as it is", st === 200 && tabsOf(readWs().workspaces[0].layout) === "view:terminal/qaone1,file:Notes/Qa host.md", readWs())
    clearWs()
    // This server listed (by a loopback address on its port: it knows itself without asking) and another one.
    const port = Number(process.env.PORT || 8793)
    write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [
      { id: "here", label: "Here", url: `http://127.0.0.1:${port}` }, { id: "box", label: "Box", url: "http://127.0.0.1:9" }] }))
    const [, ms] = await api("GET", "machines")
    const self = service(app.plugins, "machines:self") as () => Promise<string | null>
    check("machines: this server is the one at its own address", (await self()) === "here", await self())
    check("machines: it's self and online without asking itself", ms.find((m: Any) => m.id === "here")?.self === true && ms.find((m: Any) => m.id === "here")?.online === true, ms)
    await api("GET", "workspaces")
    ;[st, body] = await api("PUT", "workspaces/1", { layout: layout("view:terminal/qanew1", "view:terminal/claude_work-qa2@box", "file:Notes/Qa host.md") })
    let raw = readWs().workspaces[0].layout
    check("terminal machines: a new terminal tab is saved with this machine, another's as it is", st === 200 &&
      tabsOf(raw) === "view:terminal/qanew1@here,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", raw)
    check("terminal machines: the answer is as this machine's app has it", tabsOf(body.layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", body)
    ;[, body] = await api("GET", "workspaces")
    check("terminal machines: read back without this machine's id", tabsOf(body.workspaces[0].layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", body)
    const st8 = await app.state()
    check("terminal machines: /api/state too", tabsOf((st8.workspaces as Any)[0].layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", st8.workspaces)
    const tabsOpen = service(app.plugins, "tabs:open") as () => string[]
    check("terminal machines: tabs:open has this machine's terminals as its own", tabsOpen().includes("view:terminal/qanew1") && tabsOpen().includes("view:terminal/claude_work-qa2@box"), tabsOpen())
    // Another machine's id for this one: shown as saved (it's that machine's shell).
    ;[st, body] = await api("PUT", "workspaces/2", { layout: layout("view:terminal/qaelse@box") })
    check("terminal machines: another machine's tab stays its", tabsOf(readWs().workspaces[1].layout) === "view:terminal/qaelse@box" && tabsOf(body.layout) === "view:terminal/qaelse@box", body)
    // Moving by the place, as the app or vau names it (this machine's without its id).
    ;[st, body] = await api("POST", "workspaces/move", { to: 3, path: "view:terminal/qanew1" })
    raw = readWs().workspaces
    check("terminal machines: a move finds a tab by the place as shown, and keeps its machine", st === 200 && body.tab.to === "view:terminal/qanew1" &&
      tabsOf(raw[2].layout) === "view:terminal/qanew1@here" && !tabsOf(raw[0].layout).includes("qanew1"), [body, raw])
    ;[st, body] = await api("POST", "workspaces/move", { to: 2, open: ["view:terminal/qaopen1"] })
    check("terminal machines: a terminal opened in a workspace is this machine's", st === 200 && tabsOf(readWs().workspaces[1].layout) === "view:terminal/qaelse@box,view:terminal/qaopen1@here" &&
      body.tab.to === "view:terminal/qaopen1", [body, readWs()])
    ;[st] = await api("PUT", "workspaces/4", { layout: layout("view:terminal/qaold1@box", "view:terminal/qaold2", "view:terminal/qanew4") })
    const term = app.plugins.find((p) => p.id === "terminal")!
    const locate = term.services["terminal:locate"]
    ;[st, body] = await api("POST", "workspaces/close", { path: "view:terminal/qaold2" })
    check("terminal machines: close finds this machine's terminal by the place as shown (saved with its machine)", st === 200 &&
      body.closed.length === 1 && body.closed[0].to === "view:terminal/qaold2" && !tabsOf(readWs().workspaces[3].layout).includes("qaold2") &&
      tabsOf(readWs().workspaces[3].layout).includes("qaold1@box"), [st, body, readWs()])
    check("terminal machines: locate knows no shell nobody runs", (await (locate as (id: string) => Promise<string | null>)("qanosuch9")) === null)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
    clearWs()
    fs.rmSync(path.join(VAULT, "Notes/Qa host.md"))
    await api("GET", "workspaces") // forgets this machine's id (none listed now)
  }
  // terminal.run on another machine: passed on to its server once its copy of the file matches, the terminal named with
  // its machine; and what it refuses (here too).
  {
    const seen: string[] = []
    let peerVault: string | null = null // (this vault's, else its own)
    const peer = (await import("node:http")).createServer((req, res) => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
      if (req.url === "/api/machines/self") return json(200, { instance: "peer-2", host: "box", platform: "linux", version: "0.1.0", commit: "abc1234", plugins: ["terminal"],
        vault: peerVault ?? JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/machines/vault.json"), "utf8")).id })
      if (req.url === "/api/file?path=Notes%2FQa%20there.md") return json(200, { path: "Notes/Qa there.md", text: "Over there.\n" })
      if (req.url === "/api/file?path=Attachments%2FQa%20there.png") return json(415, { error: "'Attachments/Qa there.png' isn't text" })
      if (req.url === "/api/ops/terminal.run" && req.method === "POST") {
        let b = ""
        req.on("data", (d) => { b += d })
        req.on("end", () => { seen.push(`run ${b} ${req.headers["x-vaultite-client"]}`); json(200, { id: "claude_personal-qa1", path: "Notes/Qa there.md", shown: false, handed: true }) })
        return
      }
      if (req.url === "/api/ops/terminal.ask" && req.method === "POST") {
        let b = ""
        req.on("data", (d) => { b += d })
        req.on("end", () => { seen.push(`ask ${b}`); json(200, { id: "claude-qa2", agent: "claude", title: "Hi", shown: false }) })
        return
      }
      json(404, { error: "no such thing" })
    })
    await new Promise<void>((r) => peer.listen(0, "127.0.0.1", () => r()))
    write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [{ id: "box", label: "Box", url: `http://127.0.0.1:${(peer.address() as { port: number }).port}/` },
      { id: "gone", url: "http://127.0.0.1:9" }] }))
    await api("GET", "machines")
    write("Notes/Qa there.md", "Over there.\n")
    try {
      let [c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", machine: "box", account: "personal", prompt: "Read {path}." })
      check("terminal.run: on another machine, its terminal there, in the background", c === 200 && body.id === "claude_personal-qa1@box" && body.machine === "box" &&
        body.handed === true && body.shown === false &&
        seen[0]?.startsWith(`run ${JSON.stringify({ path: "Notes/Qa there.md", agent: "claude", prompt: "Read {path}.", open: false, account: "personal" })} machine/`), [c, body, seen])
      const passed = await app.runOp("terminal.run", { path: "Notes/Qa there.md", machine: "box" }, { who: { client: "machine/other", agent: null, label: "other", source: "other" } })
        .then(() => null, (e: Any) => e)
      check("terminal.run: one passed on from another machine isn't passed on again", passed?.status === 409, passed?.message)
      ;[c, body] = await api("POST", "ops/terminal.ask", { prompt: "Hi", machine: "box", model: "haiku" })
      check("terminal.ask: on another machine, passed on to its server, its terminal named with it", c === 200 && body.id === "claude-qa2@box" && body.machine === "box" &&
        body.shown === false && seen.includes(`ask ${JSON.stringify({ prompt: "Hi", agent: "claude", model: "haiku" })}`), [c, body, seen])
      write("Attachments/Qa there.png", "\u0089PNG")
      seen.length = 0
      ;[c, body] = await api("POST", "ops/terminal.ask", { prompt: "Look", machine: "box", files: ["Attachments/Qa there.png"] })
      check("terminal.ask: files passed on with it, once that machine has them", c === 200 && body.id === "claude-qa2@box" &&
        seen.includes(`ask ${JSON.stringify({ prompt: "Look", agent: "claude", files: ["Attachments/Qa there.png"] })}`), [c, body, seen])
      ;[c, body] = await api("POST", "ops/terminal.ask", { prompt: "Hi", machine: "gone" })
      check("terminal.ask: an offline machine says so", c === 502 && String(body.error).includes("offline"), [c, body])
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", machine: "nope" })
      check("terminal.run: an unknown machine says which there are", c === 404 && String(body.error).includes("box"), [c, body])
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", machine: "gone" })
      check("terminal.run: an offline machine says so", c === 502 && String(body.error).includes("offline"), [c, body])
      peerVault = "another"
      app.plugins.find((p) => p.id === "machines")!.forget() // (the list is kept 20 s)
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", machine: "box" })
      check("terminal.run: a machine with another vault is refused", c === 409 && String(body.error).includes("vault of its own"), [c, body])
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Nowhere.md" })
      check("terminal.run: a file that isn't there says so, nothing started", c === 404 && /there's no file/.test(String(body.error)), [c, body])
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", agent: "claude", command: "ls" })
      check("terminal.run: an agent or a command, not both", c === 400 && /not both/.test(String(body.error)), [c, body])
      ;[c, body] = await api("POST", "ops/terminal.run", { path: "Notes/Qa there.md", command: "echo {path}" })
      check("terminal.run: a command this machine hasn't run asks first", c === 409 && String(body.error).startsWith("This machine hasn't run this action's command before:"), [c, body])
    } finally {
      peer.close()
      fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
      fs.rmSync(path.join(VAULT, "Notes/Qa there.md"))
      fs.rmSync(path.join(VAULT, "Attachments/Qa there.png"), { force: true })
      await api("GET", "machines")
    }
  }
}
