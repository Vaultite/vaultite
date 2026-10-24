import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, sleep, tmp, TOOLS } = $
  const { uiLive, vau } = $.vars
  // vau open: no window, then two: only the one used last acts.
  let cr = await vau("open", "Dashboards/Errors.md")
  check("vau open: no window open says so", cr.code === 1 && cr.err.includes("no app window is open"), cr)
  const fakeWindow = () => {
    const w: Any = { OPEN: 1, readyState: 1, got: [] as Any[], close: () => {} }
    w.send = (t: string) => w.got.push(JSON.parse(t))
    w.on = (ev: string, fn: Any) => { w[`on_${ev}`] = fn }
    w.say = (m: object) => w.on_message(Buffer.from(JSON.stringify(m)))
    return w
  }
  const w1 = fakeWindow(), w2 = fakeWindow()
  uiLive.client(w1)
  uiLive.client(w2)
  w1.say({ type: "active" })
  await sleep(5)
  cr = await vau("open", "Errors", "--split", "down")
  const uiOf = (w: Any) => w.got.filter((m: Any) => m.type === "ui")
  check("vau open: the window used last gets it", cr.code === 0 && uiOf(w1).length === 1 && !uiOf(w2).length &&
    uiOf(w1)[0].action === "open" && uiOf(w1)[0].path === "Dashboards/Errors.md" && uiOf(w1)[0].split === "down", [cr, w1.got, w2.got])
  cr = await vau("open", "Errors", "--new-tab", "false")
  const nt1 = uiOf(w1).at(-1)
  cr = await vau("open", "Errors", "--new-tab")
  const nt2 = uiOf(w1).at(-1)
  check("vau: a switch takes true/false after it, or nothing", nt1.newTab === false && nt2.newTab === true, [nt1, nt2])
  w2.say({ type: "active" })
  await sleep(5)
  await vau("command", "sidebar:toggle")
  check("vau command: to the window now in use", uiOf(w2).length === 1 && uiOf(w2)[0].id === "sidebar:toggle" && uiOf(w1).length === 3, [w1.got, w2.got])
  cr = await vau("open", "x.md", "--split", "left")
  check("vau open: a bad split is refused", cr.code === 1, cr)
  // vau notify: an event in the inbox (every window toasts it), kept with or without a window.
  cr = await vau("notify", "Wrote", "the review", "--action-open", "Errors")
  let [, inboxNow] = await api("GET", "inbox/events")
  check("vau notify: an inbox event, its link a vault path", cr.code === 0 && inboxNow.events[0]?.title === "Wrote the review" && inboxNow.events[0].kind === "info" &&
    inboxNow.events[0].link === "Dashboards/Errors.md" && inboxNow.events[0].source === "vau" && !uiOf(w2).some((m: Any) => m.action === "notify"), [cr, inboxNow.events[0]])
  cr = await vau("notify", "It broke", "--error")
  ;[, inboxNow] = await api("GET", "inbox/events")
  check("vau notify --error: an error event, no link", cr.code === 0 && inboxNow.events[0]?.title === "It broke" && inboxNow.events[0].kind === "error" && !inboxNow.events[0].link, inboxNow.events[0])
  await api("DELETE", "inbox/events")
  cr = await vau("notify")
  check("vau notify: the text is required", cr.code === 1 && cr.err.includes("text is missing"), cr)
  const n = uiOf(w2).length
  check("/api/ui notify: empty text, a bad kind or button are refused, nothing sent",
    uiLive.handle("POST", { action: "notify", text: "  " })[1] === 400 && uiLive.handle("POST", { action: "notify", text: "x", kind: "warn" })[1] === 400 &&
    uiLive.handle("POST", { action: "notify", text: "x", button: { label: "Go" } })[1] === 400 && uiOf(w2).length === n)
  const [okBody, okStatus] = uiLive.handle("POST", { action: "notify", text: "Hello", button: { open: "Notes/a.md" } }) as [Any, number]
  check("/api/ui notify: a button's label defaults to Open", okStatus === 200 && okBody.ok && uiOf(w2).at(-1).button.label === "Open", uiOf(w2).at(-1))
  cr = await vau("context", "--json")
  const ctxOut = JSON.parse(cr.out)
  check("vau context: vault, pinned pages, panels, plugins, appearance, windows", cr.code === 0 && ctxOut.vault === VAULT && ctxOut.windows === 2 &&
    ctxOut.pinned.includes("Dashboards/Errors.md") && ctxOut.panels[0].key === "search:search" && ctxOut.panels[0].side === "left" && ctxOut.appearance.theme === "dark", ctxOut)
  // vau's own switches: --count and --paths read an answer's list (itself, or its first); a non-list is an error.
  cr = await vau("files", "--json")
  const allFiles = JSON.parse(cr.out).files.map((f: Any) => f.path)
  cr = await vau("files", "--count")
  check("vau --count: how many the answer lists", cr.code === 0 && cr.out === String(allFiles.length), [cr, allFiles.length])
  cr = await vau("--paths", "files")
  check("vau --paths: one path a line, before the command too", cr.code === 0 && cr.out === allFiles.join("\n"), cr)
  cr = await vau("item.list", "person", "--paths")
  check("vau --paths: an item's id is its file", cr.code === 0 && cr.out.split("\n").includes("People/Alice Park.md"), cr)
  cr = await vau("appearance", "theme", "--count")
  check("vau --count: an answer that's no list is an error", cr.code === 1 && cr.err.includes("isn't one") && !cr.out, cr)
  cr = await vau("ops.list", "--paths")
  check("vau --paths: a list of things that aren't files is an error", cr.code === 1 && cr.err.includes("aren't files"), cr)
  // stdin: `-` as any value, and a param that takes it (stdin: true) when text is piped in.
  $.vars.stdinText = "Sent from stdin\n"
  cr = await vau("notify", "-")
  let [, inboxDash] = await api("GET", "inbox/events")
  check("vau: - as an argument is stdin", cr.code === 0 && inboxDash.events[0]?.title === "Sent from stdin", [cr, inboxDash.events[0]])
  await api("DELETE", "inbox/events")
  $.vars.stdinText = "A body piped in\n"
  cr = await vau("note", "Piped", "--json")
  check("vau: a stdin param is filled when text is piped in", cr.code === 0 && read(JSON.parse(cr.out).path).includes("\nA body piped in\n"), cr)
  $.vars.stdinText = "  \n"
  cr = await vau("note", "Not piped", "--body", "Given", "--json")
  check("vau: a stdin param given isn't read", cr.code === 0 && read(JSON.parse(cr.out).path).includes("\nGiven\n"), cr)
  $.vars.stdinText = ""
  // The window answers asks (core/live.ts ask): dev tools and its commands, only once it said it answers.
  const answers: Record<string, (m: Any) => Any> = {}
  w2.send = (t: string) => {
    const m = JSON.parse(t)
    w2.got.push(m)
    const fn = answers[`${m.action}:${m.what ?? ""}`]
    if (m.rid && fn) setTimeout(() => { try { w2.say({ type: "ui-done", rid: m.rid, ran: true, result: fn(m) }) } catch (e) { w2.say({ type: "ui-done", rid: m.rid, ran: false, error: (e as Error).message }) } }, 1)
  }
  w2.say({ type: "active" })
  cr = await vau("dev", "console")
  check("vau dev: a window that doesn't answer asks (an older app) says so", cr.code === 1 && cr.err.includes("older version"), cr)
  cr = await vau("commands", "--json")
  check("vau commands: no window that answers, the app's source", cr.code === 0 && JSON.parse(cr.out).from === "source" && JSON.parse(cr.out).commands.some((c: Any) => c.id === "palette:open"), cr.out.slice(0, 200))
  w2.say({ type: "caps", answers: true })
  answers["commands:"] = () => [{ id: "z:last", name: "Last", keys: [], available: false }, { id: "a:first", name: "First thing", keys: ["Mod+1"], available: true }]
  cr = await vau("commands")
  check("vau commands: the window's, sorted, those that can't run now marked", cr.code === 0 && /^a:first\s+First thing\nz:last\s+Last {2}\(not now\)$/.test(cr.out), cr)
  cr = await vau("commands", "first", "--count")
  const cr2 = await vau("commands", "--available", "--count")
  check("vau commands: a word, --available", cr.code === 0 && cr.out === "1" && cr2.out === "1", [cr, cr2])
  answers["dev:dom"] = (m) => ({ selector: m.selector, count: 3, matches: m.all ? ["<p>a</p>", "<p>b</p>", "<p>c</p>"] : ["<p>a</p>"] })
  cr = await vau("dev", "dom", "p")
  check("vau dev dom: the first match, and how many", cr.code === 0 && cr.out === "3 matches (the first shown):\n\n<p>a</p>" && w2.got.at(-1).all === false, cr)
  cr = await vau("dev", "dom", "p", "--all", "--count")
  check("vau dev dom --all --count", cr.code === 0 && cr.out === "3", cr)
  answers["dev:eval"] = (m) => { if (m.code === "bad") throw new Error("bad is not defined"); return { value: { code: m.code } } }
  cr = await vau("dev", "eval", "1 + 1")
  check("vau dev eval: the value as JSON", cr.code === 0 && JSON.parse(cr.out).code === "1 + 1", cr)
  cr = await vau("dev", "eval", "bad")
  check("vau dev eval: the window's error, exit 1", cr.code === 1 && cr.err === "vau dev eval: bad is not defined" && !cr.out, cr)
  $.vars.stdinText = "document.title\n"
  cr = await vau("dev", "eval")
  check("vau dev eval: the code piped in", cr.code === 0 && JSON.parse(cr.out).code === "document.title", cr)
  $.vars.stdinText = ""
  const png = Buffer.from("not really a png")
  answers["dev:screenshot"] = () => ({ png: png.toString("base64"), width: 2, height: 1 })
  const shot = path.join(tmp, "shots", "one.png")
  cr = await vau("dev", "screenshot", "--out", shot)
  check("vau dev screenshot: saved where asked, its path printed", cr.code === 0 && cr.out === shot && fs.readFileSync(shot).equals(png), cr)
  // secret.ask (core/coreops/secret.ts): a hidden field in the window; only the value comes back, printed as is.
  answers["secret:"] = (m) => ({ value: `pw for ${m.prompt}`, base64: false })
  cr = await vau("secret", "Wi-Fi password")
  check("vau secret: the value given, nothing else", cr.code === 0 && cr.out === "pw for Wi-Fi password" && (cr as Any).exact === true && w2.got.findLast((x: Any) => x.action === "secret")?.file === false, cr)
  answers["secret:"] = () => null
  cr = await vau("secret", "A key", "--file")
  check("vau secret: dismissed, it fails and prints nothing", cr.code === 1 && !cr.out && cr.err.includes("didn't give it") && w2.got.findLast((x: Any) => x.action === "secret")?.file === true, cr)
  delete answers["secret:"]
  const secretEntry = app.catalog().find((e) => e.id === "secret.ask")
  check("secret.ask: no MCP tool (secrets stay on the user's machines), printed exactly", secretEntry?.mcp === null && secretEntry?.exact === true, secretEntry)
  const mcpRefused = await app.callOp("secret.ask", { prompt: "x" }, { client: "mcp", agent: null, label: "Claude", source: "claude" }).then(() => null, (e: Any) => e)
  check("secret.ask: refused over MCP (its call tool too)", mcpRefused?.status === 403, mcpRefused?.message)
  const waiting = uiLive.drive({ action: "secret", key: "k1", prompt: "x", timeout: 30 })
  await new Promise((r) => setTimeout(r, 20))
  await uiLive.drive({ action: "ask-cancel", key: "k1" })
  check("ask-cancel: a keyed ask ends with nothing (answered elsewhere), its window told to close it", (await waiting) === null && w2.got.at(-1)?.action === "ask-end", w2.got.at(-1))
  delete answers["dev:eval"]
  let t0 = Date.now()
  cr = await vau("dev", "eval", "1", "--timeout", "1")
  check("vau dev eval: no answer in time says so", cr.code === 1 && cr.err.includes("didn't answer within 1 s") && Date.now() - t0 < 3000, cr)
  check("POST /api/ui: no dev asks (only the owner's ops)", uiLive.handle("POST", { action: "dev", what: "eval", code: "1" })[1] === 400)
  const devOps = app.catalog().filter((e) => e.id.startsWith("dev."))
  check("dev ops: four, the owner's only, no MCP tool of their own", devOps.length === 4 && devOps.every((e) => e.owner && !e.mcp), devOps.map((e) => [e.id, e.owner, e.mcp]))
  const stranger = { headers: { host: "127.0.0.1:8793", "x-forwarded-for": "100.64.0.9" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage
  const devRefused = await app.callOp("dev.eval", { code: "1" }, undefined, { http: stranger }).then(() => null, (e: Any) => e)
  check("dev ops: refused to anyone but this machine's owner", devRefused?.status === 403, devRefused?.message)
  // The prompt (core/repl.ts): lines split like a shell, Tab from the catalog.
  const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
  const { split, complete } = await import("../../../core/repl.ts")
  const sp = split(`open "People/Alice P`)
  check("vau prompt: a line split like a shell, the last word as typed", sameJson(sp.words, ["open", "People/Alice P"]) && sp.partial === "People/Alice P" && sp.quote === "\"" && sp.start === 5, sp)
  check("vau prompt: quotes and backslashes", sameJson(split(`note 'a b' c\\ d ""`).words, ["note", "a b", "c d", ""]) && split("files ").partial === "" && split("files ").start === 6)
  const src = { ops: app.catalog(), local: ["sandbox", "events"], files: async () => ["People/Alice Park.md", "People/Bob Lee.md", "Notes/My idea.md"], commandIds: async () => ["sidebar:toggle", "palette:open"] }
  const tab = (line: string) => complete(line, src)
  check("vau prompt: Tab completes names, a group's words, ids once typed", sameJson(await tab("fil"), ["files"]) && (await tab("bundle ")).includes("apply") && (await tab("panels ")).includes("move") && sameJson(await tab("help dev d"), ["dom"]) && sameJson(await tab("dev s"), ["screenshot"]) &&
    (await tab("note.c")).includes("note.create") && (await tab("sand")).includes("sandbox"), [await tab("fil"), await tab("bundle "), await tab("dev s"), await tab("note.c"), await tab("sand")])
  check("vau prompt: Tab completes flags", sameJson(await tab("files --l"), ["--limit"]) && (await tab("files --")).includes("--count") && (await tab("open x --")).includes("--new-tab"))
  check("vau prompt: Tab completes choices", sameJson(await tab("dev console --level w"), ["warn"]) && sameJson(await tab("open x --split "), ["down", "right"]))
  check("vau prompt: Tab completes paths a folder at a time, quoted when they need it", sameJson(await tab("open Peo"), ["People/"]) && sameJson(await tab("open People/A"), ["\"People/Alice Park.md\""]) &&
    sameJson(await tab("open \"Notes/"), ["\"Notes/My idea.md\""]) && sameJson(await tab("open Bob"), ["\"People/Bob Lee.md\""]), [await tab("open Peo"), await tab("open People/A")])
  check("vau prompt: Tab completes palette command ids", sameJson(await tab("command side"), ["sidebar:toggle"]))
  answers["command:"] = () => null // (the window answers the commands later tests send it)
  uiLive.close()
  // bin/vau as agents run it, against a made-up server: stdin a socket left open or /dev/null, piped into a reader that
  // stops early, errors as a non-zero exit on stderr; --copy through the system's clipboard tool.
  {
    const http = await import("node:http")
    const { spawn } = await import("node:child_process")
    const big = "line of text\n".repeat(200_000)
    const entry = (id: string, cli: string, params: Record<string, Any> = {}) => ({ id, plugin: null, summary: id, help: "", kind: "read", params: { type: "object", properties: params }, args: [], cli, mcp: null, result: null, owner: null })
    const stub = http.createServer((req, res) => {
      let body = ""
      req.on("data", (c) => { body += c })
      req.on("end", () => {
        const send = (status: number, out: unknown, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(typeof out === "string" ? out : JSON.stringify(out)) }
        if (req.url?.split("?")[0] === "/api/ops") return send(200, [entry("big.text", "big"), entry("bad.thing", "boom"), entry("echo.body", "echo", { body: { type: "string", stdin: true, description: "x" } })])
        if (req.url?.startsWith("/api/ops/big.text")) return send(200, big, "text/plain")
        if (req.url?.startsWith("/api/ops/bad.thing")) return send(500, { error: "it broke" })
        if (req.url?.startsWith("/api/ops/echo.body")) return send(200, `body: ${JSON.parse(body || "{}").body ?? "(none)"}`, "text/plain")
        send(404, { error: "not found" })
      })
    })
    await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", ok))
    const url = `http://127.0.0.1:${(stub.address() as Any).port}`
    const bin = path.join(TOOLS, "..", "bin", "vau")
    const run = (args: string[], o: { stdin?: "pipe" | "ignore"; input?: string; stopAfter?: number; env?: Record<string, string> } = {}) => new Promise<{ code: number | null; out: string; err: string; ms: number }>((resolve) => {
      const t = Date.now()
      const p = spawn(process.execPath, [bin, ...args], { stdio: [o.stdin ?? "pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: tmp, VAULTITE_URL: url, ...o.env } })
      let out = "", err = ""
      p.stdout!.on("data", (c) => {
        out += c
        if (o.stopAfter && out.length >= o.stopAfter) p.stdout!.destroy() // (`| head -c`: the reader goes away)
      })
      p.stderr!.on("data", (c) => { err += c })
      if (o.input !== undefined) p.stdin?.end(o.input)
      const kill = setTimeout(() => p.kill(), 10_000)
      p.on("close", (code) => { clearTimeout(kill); resolve({ code, out, err, ms: Date.now() - t }) })
    })
    let r = await run(["big"], { stopAfter: 10 })
    check("bin/vau: piped into a reader that stops, it ends quietly", r.code === 0 && !r.err, { code: r.code, err: r.err.slice(0, 300) })
    r = await run(["echo"])
    check("bin/vau: stdin an open socket nobody writes to isn't waited for", r.code === 0 && r.out === "body: (none)\n" && r.ms < 5000, r)
    r = await run(["echo"], { input: "piped text\n" })
    check("bin/vau: a stdin param from a socket that writes", r.code === 0 && r.out === "body: piped text\n", r)
    r = await run(["echo", "--body", "-"], { stdin: "ignore" })
    check("bin/vau: - with stdin /dev/null is empty, not a hang", r.code === 0 && r.out === "body: \n", r)
    r = await run(["boom"], { stdin: "ignore" })
    check("bin/vau: a server error is exit 1, on stderr", r.code === 1 && r.out === "" && r.err === "vau boom: it broke\n", r)
    r = await run(["nope"], { stdin: "ignore" })
    check("bin/vau: an unknown command is exit 2, on stderr", r.code === 2 && r.out === "" && r.err.includes("no command 'nope'"), r)
    check("bin/vau: --count on a text-only answer is an error", (await run(["boom", "--count"], { stdin: "ignore" })).code === 1)
    r = await run([], { stdin: "ignore" })
    check("bin/vau: no arguments without a terminal is the help, exit 0", r.code === 0 && r.out.startsWith("vau: drive Vaultite"), r.out.slice(0, 100))
    stub.close()
    const { toClipboard } = await import("../../../core/cli.ts")
    const fake = path.join(tmp, "fakebin")
    fs.mkdirSync(fake, { recursive: true })
    if (process.platform === "win32") {
      // (a stand-in tool would need a shell: Windows' own clip, read back)
      const said = await toClipboard("copied text")
      const { execFileSync } = await import("node:child_process")
      const back = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" })
      check("vau --copy: the text through the system's tool", said === "" && back.trim() === "copied text", { said, back })
    } else {
      fs.writeFileSync(path.join(fake, "pbcopy"), `#!/bin/sh\nexec /bin/cat > "${path.join(fake, "clip.txt")}"\n`, { mode: 0o755 })
      const said = await toClipboard("copied text", "darwin", { PATH: fake })
      check("vau --copy: the text through the system's tool", said === "" && fs.readFileSync(path.join(fake, "clip.txt"), "utf8") === "copied text", said)
    }
    check("vau --copy: no tool says which it looked for", (await toClipboard("x", "linux", { PATH: fake })).includes("xclip"))
  }
  Object.assign($.vars, { w2, uiOf, sameJson })
}
