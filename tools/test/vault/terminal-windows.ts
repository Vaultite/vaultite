// The terminal on Windows (the terminal area's, run there only): the keeper on a named pipe outliving its server; shells
// running commands and vau; an agent started by the starter, its state hooks, one that isn't installed.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { skip, standIn, waitFor } from "../lib.ts"

const ROOT = path.resolve(import.meta.dirname, "../../..")

export default async ($: VaultTest) => {
  const { api, check, tmp } = $
  const { ptydBackend } = await import("../../../plugins/core/terminal/backend.ts")
  const { defaultShell, shellsHere } = await import("../../../plugins/core/terminal/shells.ts")
  const { distros } = await import("../../../core/wsl.ts")
  const stopKeeper = (files: string) => { try { process.kill(Number(fs.readFileSync(`${files}.pid`, "utf8")), "SIGTERM") } catch { /* none */ } }

  // The shells offered, named as Windows Terminal names them, PowerShell first.
  const shells = await shellsHere()
  check("windows: the shells offered are PowerShell's, Command Prompt and WSL's distros, PowerShell the default",
    /pwsh|powershell/i.test(defaultShell()) && shells.some((x) => x.label === "Command Prompt") && shells.some((x) => x.label === "Windows PowerShell"), shells)

  // The keeper on a named pipe: a server (another process) starts a shell and goes away; this one finds it and reattaches.
  {
    const name = `testwin-${process.pid}`, keeper = ptydBackend(name, { daemon: path.join(ROOT, "plugins/core/terminal/ptyd.ts") })
    const starter = `import { ptydBackend } from ${JSON.stringify(new URL("../../../plugins/core/terminal/backend.ts", import.meta.url).href)}
const k = ptydBackend(${JSON.stringify(name)}, { daemon: ${JSON.stringify(path.join(ROOT, "plugins/core/terminal/ptyd.ts"))} })
await k.create("pipe1", { shell: ${JSON.stringify(defaultShell())}, run: null, cwd: ${JSON.stringify(tmp)}, env: process.env, ctx: {}, cols: 100, rows: 30, scrollback: 500 })
console.log("made")
process.exit(0)`
    const file = path.join(tmp, "keeper-starter.mts")
    fs.writeFileSync(file, starter)
    const made = await new Promise<string>((ok) => {
      const p = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] })
      let out = ""
      p.stdout.on("data", (d) => { out += d }); p.stderr.on("data", (d) => { out += d })
      p.on("exit", () => ok(out.trim()))
    })
    let listed: Any = null, screen = ""
    try {
      listed = (await keeper.list()).find((x) => x.id === "pipe1") ?? null
      await waitFor(async () => (await keeper.screen("pipe1", 10)).includes(">"), 20_000, 200)
      await keeper.send("pipe1", "Write-Output ('sum=' + (2+3))", true)
      await waitFor(async () => (screen = await keeper.screen("pipe1", 20)).includes("sum=5"), 15_000, 200)
      const link = await keeper.attach("pipe1", 100, 30)
      let seen = ""
      link.onData((d) => { seen += d })
      link.write(Buffer.from("Write-Output ('again=' + (4*4))\r"))
      await waitFor(() => seen.includes("again=16"), 15_000, 100)
      screen += `\n${seen}`
      link.close()
      await keeper.kill("pipe1")
      await waitFor(async () => !(await keeper.list()).length, 10_000, 200)
    } finally { stopKeeper(keeper.files) }
    check("windows: the keeper, on a named pipe, keeps a shell its server left and lets another reattach to it", made.endsWith("made") && !!listed &&
      listed.process.match(/pwsh|powershell/) && screen.includes("sum=5") && screen.includes("again=16") && keeper.socket.startsWith("\\\\.\\pipe\\"),
      [made, listed, screen.slice(-800), keeper.socket])
  }

  // Terminals as the app starts them: vau first on Path in PowerShell and cmd, and a WSL distro's (if there is one). Only
  // on CI: the test app's keeper is the default port's, a live server's on a machine that has one.
  if (!process.env.CI) return skip("windows: the app's terminals", "only on CI (they'd share a live server's keeper)")
  const term = (await import("../../../plugins/core/terminal/plugin.ts")).plugin
  // The agents' hooks POST to the server's address: a listener there, passing each to this in-process app.
  const { createServer } = await import("node:http")
  const listener = createServer((req, res) => {
    let raw = ""
    req.on("data", (d) => { raw += d }).on("end", async () => {
      let body: unknown = {}
      try { body = raw ? JSON.parse(raw) : {} } catch { body = raw }
      const [code, r] = await api(req.method ?? "GET", (req.url ?? "/").replace(/^\/api\//, ""), body, req)
      res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(r ?? null))
    })
  })
  await new Promise<void>((ok) => listener.listen(0, "127.0.0.1", ok))
  const portWas = process.env.PORT
  process.env.PORT = String((listener.address() as { port: number }).port)
  const screenOf = async (id: string) => { const [, r] = await api("GET", `terminals/${id}/screen?lines=60`); return ((r?.lines ?? []) as string[]).join("\n") }
  const run = async (id: string, shell: string, text: string, want: RegExp) => {
    term.patchSettings({ shell })
    let code: number, r: Any
    ;[code, r] = await api("POST", `terminals/${id}`)
    let shown = ""
    if (code === 200) {
      await waitFor(async () => (shown = await screenOf(id)).trim().length > 0, 60_000, 300)
      await api("POST", `terminals/${id}/send`, { text, enter: true })
      await waitFor(async () => want.test(shown = await screenOf(id)), 60_000, 300)
      await api("DELETE", `terminals/${id}`)
    }
    return { code, r, shown }
  }
  try {
    const pwsh = await run("winpwsh1", "", "vau --help | Select-Object -First 1; Write-Output \"term=$env:VAULTITE_TERMINAL\"", /term=winpwsh1/)
    check("windows: PowerShell is the default shell, vau --help works there, it knows its terminal", pwsh.shown.includes("vau: drive Vaultite") && pwsh.shown.includes("term=winpwsh1"), pwsh)
    const cmd = await run("wincmd1", process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", "vau --help | findstr /c:\"drive Vaultite\" & echo term=%VAULTITE_TERMINAL%", /term=wincmd1/)
    check("windows: Command Prompt runs commands and vau there", cmd.shown.includes("vau: drive Vaultite") && cmd.shown.includes("term=wincmd1"), cmd)
    const wsl = (await distros())[0]
    if (!wsl) skip("windows: a WSL distro's shell", "no WSL distro on this machine")
    else {
      const w = await run("winwsl1", `wsl:${wsl}`, "echo \"term=$VAULTITE_TERMINAL pwd=$(pwd)\"; vau --help | head -1", /vau: drive Vaultite/)
      check("windows: a WSL distro's shell starts in the vault's folder, knows its terminal and runs Windows' vau", w.shown.includes("term=winwsl1") &&
        w.shown.includes("pwd=/mnt/") && w.shown.includes("vau: drive Vaultite"), w)
      // Claude Code inside WSL (a stand-in in the distro's ~/.local/bin): its POSIX hooks write the state with WSL's
      // paths, and its report reaches Activity through Windows' curl.
      const fake = `#!/usr/bin/env python3
import json, subprocess, sys, time
a = sys.argv[1:]
s = json.loads(a[a.index("--settings") + 1])
def hook(e, i=0, stdin=None): subprocess.run(["sh", "-c", s["hooks"][e][i]["hooks"][0]["command"]], input=stdin, text=True)
hook("SessionStart")
print("FAKE-CLAUDE-WSL prompt=" + a[-1], flush=True)
hook("UserPromptSubmit")
hook("PostToolUse", 1, json.dumps({"tool_name": "Bash", "tool_input": {"command": "echo from-wsl"}}))
sys.stdin.readline()
hook("Stop")
print("FAKE-CLAUDE-WSL stopped", flush=True)
time.sleep(120)
`
      await new Promise<void>((ok) => {
        // (root's login shell has no ~/.local/bin on PATH)
        const p = spawn("wsl.exe", ["-d", wsl, "-e", "sh", "-c", 'd=/usr/local/bin; [ -w "$d" ] || { d="$HOME/.local/bin"; mkdir -p "$d"; }; cat > "$d/claude" && chmod +x "$d/claude"'], { stdio: ["pipe", "ignore", "ignore"] })
        p.on("exit", () => ok()); p.stdin.end(fake)
      })
      term.patchSettings({ shell: `wsl:${wsl}` })
      const state = () => (term.services["terminal:state"] as (id: string) => Any)("claude-winwsl01")?.state ?? null
      let shown = "", working: Any = null, idle: Any = null
      await api("POST", "terminals/claude-winwsl01", { prompt: "it's \"quoted\"" })
      await waitFor(async () => (shown = await screenOf("claude-winwsl01")).includes("FAKE-CLAUDE-WSL prompt="), 90_000, 300)
      working = await waitFor(() => (state() === "working" ? "working" : null), 20_000, 200)
      await api("POST", "terminals/claude-winwsl01/send", { text: "go", enter: true })
      idle = await waitFor(() => (state() === "idle" ? "idle" : null), 20_000, 200)
      const ran = await waitFor(async () => { const [, r] = await api("GET", "activity"); return JSON.stringify(r).includes("Ran echo from-wsl") || null }, 10_000, 300)
      shown = await screenOf("claude-winwsl01")
      await api("DELETE", "terminals/claude-winwsl01")
      if (!(working && idle && ran)) console.log("WSL agent's screen:\n" + shown)
      check("windows: Claude Code in a WSL distro starts with its prompt whole, its hooks marking working then idle, its report in Activity",
        shown.includes('FAKE-CLAUDE-WSL prompt=it\'s "quoted"') && working === "working" && idle === "idle" && !!ran, [shown.slice(-1500), working, idle, ran])
    }

    // An agent from PowerShell: Claude Code (a stand-in, an npm-style .cmd) started by the starter with its arguments
    // whole, its http hooks marking its state, SessionStart's by curl.
    const bin = path.join(tmp, "winagents")
    standIn(bin, "claude", `import { execFileSync } from "node:child_process"
import readline from "node:readline"
const args = process.argv.slice(2), settings = JSON.parse(args[args.indexOf("--settings") + 1])
const hook = (event) => { const h = settings.hooks[event][0].hooks[0]; if (h.type === "http") return fetch(h.url, { method: "POST", body: "{}" }); execFileSync(h.command, h.args) }
hook("SessionStart")
console.log("FAKE-CLAUDE prompt=" + args.at(-1) + " theme=" + settings.theme)
await hook("UserPromptSubmit")
const rl = readline.createInterface({ input: process.stdin })
rl.once("line", async () => { await hook("Stop"); console.log("FAKE-CLAUDE stopped") })
setTimeout(() => process.exit(0), 120000)
`)
    const was = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${was}`
    term.patchSettings({ shell: "" })
    const state = () => (term.services["terminal:state"] as (id: string) => Any)("claude-winst001")?.state ?? null
    let started: Any, working: Any = null, idle: Any = null, shown = ""
    try {
      ;[, started] = await api("POST", "terminals/claude-winst001", { prompt: "say \"hi\" & 100% done" })
      await waitFor(async () => (shown = await screenOf("claude-winst001")).includes("FAKE-CLAUDE prompt="), 60_000, 300)
      working = await waitFor(() => (state() === "working" ? "working" : null), 20_000, 200)
      if (!working) {
        await api("POST", "terminals/claude-winst001/send", { text: "Write-Output \"PATH=$env:Path\"; Get-ChildItem -Name $env:TEMP | Select-Object -First 3", enter: true })
        await new Promise((r) => setTimeout(r, 3000))
        console.log("bin:", bin, fs.readdirSync(bin), "test PATH:", process.env.PATH)
      }
      await api("POST", "terminals/claude-winst001/send", { text: "go", enter: true })
      idle = await waitFor(() => (state() === "idle" ? "idle" : null), 20_000, 200)
      shown = await screenOf("claude-winst001")
      await api("DELETE", "terminals/claude-winst001")
    } finally { process.env.PATH = was }
    if (!(working && idle)) console.log("the agent's screen:\n" + shown)
    check("windows: an agent in PowerShell starts through the starter with its prompt whole, its hooks marking working then idle",
      started?.agent === "claude" && shown.includes('FAKE-CLAUDE prompt=say "hi" & 100% done') && working === "working" && idle === "idle", [started, shown.slice(-1500), working, idle])

    // Codex isn't installed here: the starter says so, the terminal is marked missing.
    let missing: Any = null
    ;[, started] = await api("POST", "terminals/codex-winmiss01")
    missing = await waitFor(async () => { const [, r] = await api("GET", "terminals/sessions"); return (r.sessions as Any[]).find((x) => x.id === "codex-winmiss01" && x.missing) ?? null }, 60_000, 500)
    shown = await screenOf("codex-winmiss01")
    await api("DELETE", "terminals/codex-winmiss01")
    check("windows: an agent that isn't installed is marked missing, its terminal saying why", !!missing && /codex: not found/.test(shown), [missing, shown])
  } finally {
    term.patchSettings({ shell: null })
    listener.close()
    if (portWas === undefined) delete process.env.PORT; else process.env.PORT = portWas
    const { runtimeDir } = await import("../../../core/runtime.ts")
    for (const f of fs.readdirSync(runtimeDir()).filter((n) => /^vaultite-ptyd\d-vaultite.*\.sock$/.test(n.replace(/\.pid$/, "")) && n.endsWith(".pid"))) {
      stopKeeper(path.join(runtimeDir(), f.replace(/\.pid$/, "")))
    }
  }
}
