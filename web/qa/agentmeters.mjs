// Agent meters (plugins/core/agent-meters): a terminal running Claude Code (a stand-in program named claude, and a faked
// session in <claude dir>/sessions with a transcript whose last request read 51k tokens 2.5 min ago, 5 min cache) shows
// its context as a bar beside its row's name and, idle, its icon in its colour dimmed from the top as far as the cache
// ran out; an expired cache greys it; "As a bar" draws the cache as a second bar instead. Turns the plugin on and writes
// its settings and the sidebars (put back), runs a shell, writes in <claude dir>: a throwaway server started with
// CLAUDE_CONFIG_DIR=<claude dir>, never the real ~/.claude.
//   node web/qa/agentmeters.mjs <base url> <vault path> <claude dir> [out dir]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, CLAUDE, OUT = "/tmp/agentmeters-shots/"], browser, check, watch, done } = await qa(import.meta.url)
if (path.resolve(CLAUDE) === path.join(process.env.HOME, ".claude")) { console.error("not the real ~/.claude"); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const api = async (p, init) => (await fetch(new URL(`/api/${p}`, B), init)).json()
const send = (id, text) => fetch(new URL(`/api/terminals/${encodeURIComponent(id)}/send`, B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })

// A stand-in for Claude Code: a program named claude that only sleeps (a copied system binary won't run: its signature).
const standDir = mkdtempSync(path.join(tmpdir(), "qa-claude-"))
const stand = path.join(standDir, "claude")
writeFileSync(`${stand}.c`, "#include <unistd.h>\n#include <stdlib.h>\nint main(int c, char **v) { sleep(c > 1 ? atoi(v[1]) : 60); return 0; }\n")
execFileSync("cc", ["-o", stand, `${stand}.c`])

const SID = "0a1b2c3d-9999-4222-8333-444455556666"
const transcript = path.join(CLAUDE, "projects", "-qa-meters", `${SID}.jsonl`)
/** The transcript's last request, `ago` seconds ago (`pad` grows the file, so the server reads it again). */
const request = (ago, pad = "") => {
  mkdirSync(path.dirname(transcript), { recursive: true })
  writeFileSync(transcript, JSON.stringify({ type: "assistant", sessionId: SID, timestamp: new Date(Date.now() - ago * 1000).toISOString(), message: { model: "claude-sonnet-4-5",
    usage: { input_tokens: 2, cache_read_input_tokens: 50000, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 0 }, output_tokens: 10 } } }) + "\n" + pad)
}
const settings = path.join(VAULT, ".vaultite/plugins/agent-meters/data.json")
const pluginsBefore = await api("config/plugins"), sidebarsBefore = await api("config/sidebars")
const term = `qa${Date.now().toString(36)}`
const stateFile = path.join(tmpdir(), "vaultite-terminal", "states", term)
let fakeFile = ""

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
try {
  await api("config/plugins", { method: "PATCH", body: JSON.stringify({ disabled: ["workspaces"], enabled: [...(pluginsBefore.enabled ?? []), "agent-meters"] }) })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] }) })
  // (turning a plugin on reloads the app's plugins: the terminal opens once that's done)
  await page.goto(B); await page.waitForSelector("aside"); await wait(1500)
  await page.goto(`${B}#view/terminal%2F${term}`)
  const listed = await until(async () => (await api("terminals/sessions")).sessions?.some((x) => x.id === term), 10000)
  await send(term, "echo QA-PID-$$")
  const pid = Number(await until(async () => /QA-PID-(\d+)/.exec(((await api(`terminals/${encodeURIComponent(term)}/screen`)).lines ?? []).join("\n"))?.[1], 10000)) || 0
  check("the terminal's shell runs", listed && pid > 0, pid)
  // Its session: Claude Code's file for the process (the shell, which the stand-in runs under), and its transcript.
  request(150)
  mkdirSync(path.join(CLAUDE, "sessions"), { recursive: true })
  fakeFile = path.join(CLAUDE, "sessions", `${pid}.json`)
  writeFileSync(fakeFile, JSON.stringify({ pid, sessionId: SID, cwd: "/Users/sam/lighthouse", startedAt: Date.now(), kind: "interactive", status: "idle" }))
  mkdirSync(path.dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, "idle")
  await send(term, `${stand} 300`)

  const row = `aside [data-session='${term}']`, icon = `${row} svg`
  const bar = await until(() => page.$(`${row} [data-meter='context'] span`), 15000)
  const width = await bar?.evaluate((e) => parseFloat(e.style.width))
  check("its row shows its context as a bar: 51k of 200k", Math.abs((width ?? 0) - 25.5) < 1, width)
  const tip = await page.$eval(row, (e) => e.getAttribute("aria-label")).catch(() => null)
  check("  its label (the rail's tooltip) says it in words, with the cache's time left", /Context 51k of 200k \(26%\), cache 3 min left/.test(tip ?? ""), tip)
  const look = () => page.$eval(icon, (e) => ({ cls: e.getAttribute("class") ?? "", colour: e.style.color })).catch(() => null)
  const half = await look()
  check("idle, its icon keeps its colour while the cache lasts", half?.colour === "var(--orange)", half)
  check("  dimmed from the top as far as the cache ran out (half)", /mask-image:linear-gradient\(to_bottom,rgb\(0_0_0\/0\.3\)_50%/.test(half?.cls ?? ""), half?.cls)
  await page.screenshot({ path: `${OUT}draining.png`, clip: { x: 0, y: 160, width: 240, height: 80 } })

  request(400, "\n")
  const grey = await until(async () => { const l = await look(); return l && !l.colour && !l.cls.includes("mask-image") }, 10000)
  check("an expired cache greys it", grey, await look())

  mkdirSync(path.dirname(settings), { recursive: true })
  writeFileSync(settings, JSON.stringify({ cache: "bar", context: "percent" }))
  request(60, "\n\n")
  const cacheLeft = () => page.$eval(`${row} [data-meter='cache'] span`, (e) => parseFloat(e.style.width)).catch(() => null)
  await until(async () => (await cacheLeft()) > 50, 10000)
  const left = await cacheLeft()
  check('"As a bar": the cache is a bar instead, 4 of 5 min left', Math.abs((left ?? 0) - 80) < 6, left)
  check("  the icon stays grey, undimmed", !(await look())?.cls.includes("mask-image"), await look())
  const pct = await page.$eval(`${row} [data-meter='context']`, (e) => e.textContent).catch(() => null)
  check('  "Percent used": its context as a number', pct === "26%", pct)
  await page.screenshot({ path: `${OUT}bars.png`, clip: { x: 0, y: 160, width: 240, height: 80 } })
} finally {
  await fetch(new URL(`/api/terminals/${encodeURIComponent(term)}`, B), { method: "DELETE" }).catch(() => {})
  await api("config/plugins", { method: "PATCH", body: JSON.stringify({ disabled: pluginsBefore.disabled ?? [], enabled: pluginsBefore.enabled ?? [] }) })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify(sidebarsBefore) })
  for (const f of [fakeFile, transcript, settings, stateFile]) if (f && existsSync(f)) rmSync(f)
  rmSync(standDir, { recursive: true, force: true })
  await wait(100)
}
await done()
