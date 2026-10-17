// The app's coding agents (Claude Code, Codex) on a server, end to end on a sandbox (tools/test/agentkit.ts).
// VAULTITE_AGENT_LIVE=1: the real ones too; VAULTITE_TEST_PORT, VAULTITE_AGENT_KEEP=1.
import path from "node:path"
import fs from "node:fs"
import { WebSocket } from "ws"
import { type Any, check, sleep, skip, section, summary, waitFor } from "./test/lib.ts"
import { BASE, LIVE, PORT, api, REPO, TMP, VAULT, agentPath, endAndCheck, fakesPath, hideFake, makeVault, mcpTools, rand, run, screenHas, serverLog,
  setBackend, setEnv, shellFake, startServer, stopBackends, stopServer, term, which } from "./test/agentkit.ts"

const t0 = Date.now()
const AGENTS = ["claude", "codex"]

// =====================================================================================================================
// Part 1: fake agents

async function fixturePart() {
  section("fixtures: the server, MCP")
  for (const name of AGENTS) shellFake(name)
  setEnv(fakesPath())
  await startServer()
  check("server: answers on 127.0.0.1 only", serverLog().includes(`http://127.0.0.1:${PORT}`))
  // The vault's MCP server as an agent runs it (vau mcp by this Node), over stdio.
  await mcpTools({ command: process.execPath, args: [path.join(REPO, "bin", "vau"), "mcp"], env: { VAULTITE_URL: BASE } }, "lighthouse-agent", null)

  // File watching: a change made on disk is pushed to the app (/api/events), in new folders with accents too.
  section("fixtures: file watching")
  const events: Any[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/events`)
  ws.on("message", (d) => { try { events.push(JSON.parse(String(d))) } catch { /* not JSON */ } })
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j) })
  await sleep(500)
  const changed = (rel: string, ms = 5000) => waitFor(() => events.some((e) => e.type === "change" && (e.paths === null || e.paths.includes(rel))), ms, 100)
  const nested = "Nouveau dossier é/Sous dossier ü/Watched note.md"
  fs.mkdirSync(path.join(VAULT, path.dirname(nested)), { recursive: true })
  await sleep(300) // inotify watches a new folder once it's seen it: the file comes after
  fs.writeFileSync(path.join(VAULT, nested), "---\ntype: note\n---\nWatched once.\n")
  check("watch: a file made on disk in new folders (accents, spaces) is pushed", await changed(nested), events.slice(-3))
  const [, r1t] = await api("GET", `render?path=${encodeURIComponent(nested)}`)
  check("watch: the API reads it", String(r1t).includes("Watched once."), r1t)
  events.length = 0
  fs.appendFileSync(path.join(VAULT, nested), "Watched twice.\n")
  check("watch: an edit on disk is pushed", await changed(nested), events.slice(-3))
  events.length = 0
  const deep = "Nouveau dossier é/Sous dossier ü/Plus profond/Deep note.md"
  fs.mkdirSync(path.join(VAULT, path.dirname(deep)), { recursive: true })
  fs.writeFileSync(path.join(VAULT, deep), "---\ntype: note\n---\nDeep.\n")
  check("watch: a file made at once with its new folder is pushed", await changed(deep), events.slice(-3))
  events.length = 0
  fs.rmSync(path.join(VAULT, nested))
  check("watch: a file removed on disk is pushed", await changed(nested), events.slice(-3))
  ws.close()

  await terminalsPart("vaultite")
  await stopServer()
  stopBackends()
  if (["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].some((p) => fs.existsSync(p))) {
    await startServer()
    await setBackend("tmux")
    await terminalsPart("tmux")
    await stopServer()
    stopBackends()
  } else skip("terminals in tmux", "tmux isn't installed")
}

/** The fake agents in terminals of one backend: started in the vault's folder, listed, surviving a server restart,
 *  ended with nothing left; text sent whole; a missing binary. */
async function terminalsPart(backend: string) {
  section(`fixtures: terminals (${backend === "vaultite" ? "the keeper" : backend})`)
  const tag = backend === "vaultite" ? "keeper" : backend
  const ids = Object.fromEntries(AGENTS.map((a) => [a, `${a}-${rand()}`]))
  for (const [agent, id] of Object.entries(ids)) {
    const [c, r] = await term.start(id)
    check(`${agent} (${tag}): a terminal starts it`, c === 200 && r.started && r.agent === agent, r)
    const screen = await screenHas(id, new RegExp(`FAKE-${agent.toUpperCase()}`))
    check(`${agent} (${tag}): it runs in the vault's folder (spaces, accents)`, screen?.includes(`CWD ${VAULT}`), screen?.slice(-400))
    const listed = await waitFor(async () => { const s = await term.one(id); return s?.busy && s.agent === agent ? s : null })
    check(`${agent} (${tag}): Terminals lists it, running`, listed && listed.backend === backend, await term.one(id))
  }

  // The server restarts (a deploy): the shells live on in the backend.
  await stopServer()
  await startServer()
  for (const [agent, id] of Object.entries(ids)) {
    const s = await waitFor(() => term.one(id), 10000)
    check(`${agent} (${tag}): its terminal survives a server restart`, s?.busy, s)
    const screen = await term.screen(id)
    check(`${agent} (${tag}): its screen is still there`, screen.includes(`FAKE-${agent.toUpperCase()}`), screen.slice(-300))
  }
  for (const [agent, id] of Object.entries(ids)) await endAndCheck(`${agent} (${tag})`, id)

  // vau terminal send: a long text arrives whole, as one bracketed paste where the program asked for those (an agent
  // takes typed text in the pty's ~1 KB pieces, each a paste of its own, and drops some while busy); a short one typed.
  const recorder = path.join(TMP, "recorder.mjs")
  fs.writeFileSync(recorder, [
    `import fs from "node:fs"`,
    `const [out, bp] = process.argv.slice(2); let got = ""`,
    `process.stdin.setRawMode(true); process.stdout.write((bp === "1" ? "\\x1b[?2004h" : "") + "REC-READY\\r\\n")`,
    `process.stdin.on("data", (d) => { got += d; if (got.endsWith("\\r")) { fs.writeFileSync(out, got); process.stdout.write(bp === "1" ? "\\x1b[?2004l" : ""); process.exit(0) } })`,
  ].join("\n"))
  const long = Array.from({ length: 1700 }, (_, i) => `w${i}`).join(" ") + " café ü \x1b[201~ end" // (~10k, a stray end marker in it)
  for (const bp of [true, false]) {
    const id = rand(), out = path.join(TMP, `sent-${id}`)
    await term.start(id)
    await screenHas(id, /\$ *$/m, 15000)
    await term.send(id, `node ${recorder} ${out} ${bp ? 1 : 0}`)
    await screenHas(id, /REC-READY/)
    await term.send(id, "ok", false)
    await term.send(id, long)
    const got = await waitFor(() => { try { return fs.readFileSync(out, "utf8") } catch { return null } }, 10000)
    const clean = long.replace("\x1b[201~", ""), want = bp ? `ok\x1b[200~${clean}\x1b[201~\r` : `ok${clean}\r`
    check(`send (${tag}): ${long.length} characters arrive whole, ${bp ? "as one bracketed paste" : "typed (no bracketed paste asked)"}, its stray marker out; a short text typed`,
      got === want, { got: got?.length, want: want.length, start: JSON.stringify(got?.slice(0, 40)), end: JSON.stringify(got?.slice(-40)) })
    await endAndCheck(`send (${tag})`, id)
  }

  if (backend !== "vaultite") return // the rest is the same in every backend

  // An agent that isn't installed: the terminal says so and stays a shell.
  hideFake("claude")
  const id = `claude-${rand()}`
  await term.start(id)
  const s = await screenHas(id, /not found|No such file/i, 15000)
  const shell = await waitFor(async () => { const x = await term.one(id); return x && !x.busy ? x : null }, 10000)
  check("claude: missing, its terminal says it isn't found and stays a shell", s && shell, { screen: (await term.screen(id)).slice(-300), shell: await term.one(id) })
  await endAndCheck("claude missing", id)
  hideFake("claude", true)
}

// =====================================================================================================================
// Part 2: the real agents, started in a terminal when installed (not signed in here: no prompt is sent)

async function livePart() {
  section("live: the real agents")
  setEnv(agentPath())
  await startServer()
  await setBackend("vaultite")
  for (const agent of AGENTS) {
    if (!which(agent, agentPath())) { skip(`live ${agent}`, "not installed"); continue }
    const id = `${agent}-${rand()}`
    await term.start(id)
    const s = await waitFor(async () => { const x = await term.one(id); return x?.busy ? x : null }, 20000)
    check(`live ${agent}: a terminal starts it`, s, { list: await term.one(id), screen: (await term.screen(id, 30)).slice(-500) })
    await endAndCheck(`live ${agent}`, id)
  }
  await stopServer()
  stopBackends()
}

await run(async () => {
  await makeVault(["codex"])
  await fixturePart()
  if (LIVE) await livePart()
  else skip("live agents", "set VAULTITE_AGENT_LIVE=1 to run the real agents")
})
process.exit(summary("agents", t0))
