// Every UI QA script (web/qa/*.mjs), each on a fresh sandbox and server, runs kept; exit 1 on any failure (npm run qa).
// node tools/qa.ts [script...] [--repeat 3] [--jobs 3]; --lint: selectors QA scripts use that no source draws.
import "./test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { freePort, killTree, record, sleep, stopTerminals, testServer } from "./test/lib.ts"
import { front, slot } from "./qa_slots.ts"
import { FRONT, QA, SKIP, allScripts, head } from "./qa_scripts.ts"
import { type Boot, copyTemplate, template, type Variant } from "./qa_template.ts"
import { asInteractiveJob, throttled } from "./qa_job.ts"
import { officialBundles, officialRepos } from "./test/official.ts"
import { ANCHOR, localToday } from "../core/sandbox.ts"
import { sharedTmp } from "../core/testrun.ts"
import { MARK, carrying, endAll } from "./test/leftovers.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const OFFICIAL = path.resolve(process.env.VAULTITE_PLUGINS ?? path.join(ROOT, "..", "vaultite-plugins"))
const TIMEOUT = 8 * 60_000
/** Scripts on the sample as written, whatever the day: counts that only go down need the same files every run, and a
 *  sandbox dated to today has that day's logs. */
const UNDATED = new Set(["counts", "requests", "a11y"])
/** Budgets of the app alone: without Vaultite/plugins' own, whose checkout moves on its own (its bundles, renders and
 *  polls, dispatch's every 5 s, aren't this repo's to pin). */
const ALONE = new Set(["counts", "requests"])

const argv = process.argv.slice(2)
if (argv.includes("--lint")) process.exit(lint())

/** Selectors no source draws: [data-x] anywhere in a script, #id as a selector call's argument. One the script makes
 *  itself counts as drawn, and data-fence (plugin-compat's, a vault plugin of its own), and one it asserts is gone. */
function lint() {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])
  // (and the toasts' library, which draws its own)
  const src = ["web/src", "web/index.html", "plugins", "core", "electron", "tools/fixtures", "node_modules/sonner/dist/index.mjs"].flatMap((d) => fs.statSync(path.join(ROOT, d)).isDirectory() ? walk(path.join(ROOT, d)) : [path.join(ROOT, d)])
    .filter((f) => /\.(tsx?|css|html|mjs|cjs|js)$/.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n")
  const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
  const drawn = (attr: string, own: string) => [src, own].some((t) => new RegExp(`data-${attr}(?![\\w-])`).test(t.replaceAll(`[data-${attr}`, ""))) ||
    new RegExp(`dataset\\.${camel(attr)}\\b`).test(src)
  // (`!(await page.$(sel))`, `(await page.locator(sel).count()) === 0`: what a change retired may stay retired)
  const gone = /(?<!!)!\(?await [\w.]+\.\$\(\s*(["'`])[^"'`]*\1\s*\)\)?|\(await [\w.]+\.(?:locator|\$\$)\(\s*(["'`])[^"'`]*\2\s*\)(?:\.count\(\))?\)(?:\.length)? === 0/g
  const bad: string[] = []
  for (const f of fs.readdirSync(QA).filter((f) => f.endsWith(".mjs"))) {
    const text = fs.readFileSync(path.join(QA, f), "utf8").replace(gone, "")
    for (const a of new Set([...text.matchAll(/\[data-([a-z0-9-]+)/g)].map((m) => m[1]))) if (!drawn(a, text) && a !== "fence") bad.push(`${f}: [data-${a}]`)
    const calls = text.matchAll(/(?:locator|\$|\$\$|\$eval|\$\$eval|waitForSelector|querySelector(?:All)?|isVisible|click|tap|hover|fill)\(\s*(["'`])([^"'`]+)\1/g)
    for (const [, , sel] of calls) for (const [, id] of sel.matchAll(/(?:^|[\s>,(])#([a-z][\w-]*)/g)) {
      if (![src, text].some((t) => new RegExp(`["'\`]${id}["'\`]|id=\\\\?["']?${id}\\b`).test(t))) bad.push(`${f}: #${id}`)
    }
  }
  for (const b of bad) console.log(`FAIL ${b}: not in web/src, plugins, core or electron`)
  console.log(bad.length ? `\n${bad.length} selectors match nothing` : "QA selectors: all found")
  return bad.length ? 1 : 0
}
const opt = (name: string, d: number) => { const i = argv.indexOf(`--${name}`); return i < 0 ? d : Number(argv.splice(i, 2)[1]) }
const repeat = opt("repeat", 1), jobs = opt("jobs", 3)
const names = argv.length ? argv.map((a) => path.basename(a, ".mjs"))
  : allScripts().filter((n) => !SKIP.has(n))
// Electron's binary, fetched on its first use when npm skipped its install script: once here, before scripts launch it
// together (one would run it half written: ETXTBSY), by Playwright's _electron or the path require("electron") gives.
const desktop = (n: string) => { try { return /_electron\b|\("electron"\)/.test(fs.readFileSync(path.join(QA, `${n}.mjs`), "utf8")) } catch { return false } }
if (names.some(desktop)) createRequire(import.meta.url)("electron")
// On Linux the desktop scripts get a virtual display of their own, as CI's: on the user's, their windows go full screen
// through its window manager and take its focus (SHOW=1: on the user's display).
const own = process.platform === "linux" && !process.env.VAULTITE_QA_XVFB && !(process.env.SHOW && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY))
if (names.some(desktop) && own) {
  const env: NodeJS.ProcessEnv = { ...process.env, VAULTITE_QA_XVFB: "1" }
  delete env.WAYLAND_DISPLAY
  const r = spawnSync("xvfb-run", ["-a", process.execPath, ...process.argv.slice(1)], { stdio: "inherit", env })
  if (r.error && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error("qa: the desktop scripts need a display, and there's none (DISPLAY) nor xvfb-run (apt install xvfb)")
    process.exit(1)
  }
  if (!r.error) process.exit(r.status ?? 1)
  console.error("qa: no xvfb-run (apt install xvfb): the desktop scripts run on this display, among its windows")
}
// On a Mac, from a background job, the run again as an interactive one (tools/qa_job.ts)
if (process.platform === "darwin" && !process.env.VAULTITE_QA_JOB && await throttled()) {
  console.log("qa: this Mac holds back this job's timers (a background launchd job): running as an interactive one")
  const code = await asInteractiveJob(process.argv.slice(1))
  if (code !== null) process.exit(code)
  console.log("qa: launchd wouldn't take the job (no GUI session?): running here, motion checks may fail")
}


/** The usage line's arguments, after `node web/qa/<name>.mjs`. */
function usage(name: string) {
  const m = new RegExp(`node web/qa/${name}\\.mjs([^\\n(]*)`).exec(head(name))
  return (m?.[1] ?? "").match(/<[^>]+>|\[[^\]]+\]/g) ?? []
}

/** Stand-ins for the coding agents the app starts by name (its own and Vaultite/plugins'): they say their name, then sleep.
 *  QA's terminals find them first (VAULTITE_AGENT_BIN), so QA never starts a real agent nor finds one missing. */
function standIns() {
  // (compiled, so its process is named as the agent: a script runs as sh, and a copied system binary won't run)
  const code = `#include <stdio.h>\n#include <string.h>\n#include <unistd.h>\nint main(int c, char **v) { const char *n = strrchr(v[0], '/');
    printf("%s: a stand-in for QA\\n", n ? n + 1 : v[0]); fflush(stdout); sleep(3600); return 0; }\n`
  const names = ["codex", "agent", "opencode", "openclaw", "hermes"]
  const key = createHash("sha256").update(JSON.stringify([code, names, process.platform, process.arch])).digest("hex").slice(0, 12)
  // (built once per source, renamed in whole: two runs at once, or one stopped midway, never use half of it)
  const dir = path.join(sharedTmp(), `vaultite-qa-agents-${key}`)
  // (each, not the folder: a Mac's temp cleanup deletes files over 3 days old, tools/qa_template.ts)
  if (["claude", ...names].every((n) => fs.existsSync(path.join(dir, n)))) return dir
  fs.rmSync(dir, { recursive: true, force: true })
  const work = fs.mkdtempSync(`${dir}.making-`), src = path.join(work, "agent.c")
  try {
    fs.writeFileSync(src, code)
    execFileSync("cc", ["-o", path.join(work, "claude"), src])
    fs.rmSync(src)
    for (const name of names) fs.linkSync(path.join(work, "claude"), path.join(work, name))
    try { fs.renameSync(work, dir) } catch (e) { if (!fs.existsSync(dir)) throw e }
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
  return dir
}
const AGENT_BIN = standIns()

type Server = { base: string, port: number, proc: ReturnType<typeof spawn> }
async function serve(vault: string, local: string, env: Record<string, string>): Promise<Server> {
  const port = await freePort()
  const proc = testServer({
    cwd: ROOT, stdio: "ignore", env: { ...process.env, VAULTITE_HOSTS: "home-mac.example.ts.net", ...env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local },
  })
  const base = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 800; i++) { try { if ((await fetch(`${base}api/state`)).ok) return { base, port, proc } } catch { await sleep(50) } }
  throw new Error(`the server on ${vault} didn't start`)
}
/** Stops it and its terminals; resolves once it exited (or 5 s on), so nothing writes into its folders after. */
async function stop(s: Server) {
  if (s.proc.exitCode === null && s.proc.signalCode === null) {
    const gone = new Promise((r) => s.proc.once("exit", r))
    s.proc.kill()
    await Promise.race([gone, sleep(5000)])
  }
  stopTerminals(s.port)
}

/** What a script and its servers get besides their vault: the stand-in agents, Claude's made-up home `claude`, and the
 *  made-up repositories under `repos` (web/qa/pluginstore.mjs; a bundle's Vaultite plugins from them, never GitHub). */
function envFor(claude: string, repos: string): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: claude, VAULTITE_AGENT_BIN: AGENT_BIN }
  // (the desktop scripts' app as root, a container's user: Chromium starts only unsandboxed then)
  if (process.getuid?.() === 0) env.ELECTRON_DISABLE_SANDBOX = "1"
  env.VAULTITE_GITHUB = officialRepos(repos)
  env.VAULTITE_BUNDLES = officialBundles(repos)
  return env
}
const claudeHome = (dir: string) => { fs.cpSync(path.join(ROOT, "tools/fixtures/claude"), dir, { recursive: true }); return dir }

/** The template's server: a script's, on the template's folders. */
const boot: Boot = async (at, scratch) => {
  const s = await serve(at.vault, at.local, envFor(claudeHome(path.join(scratch, "claude")), at.repos))
  return { base: s.base, stop: () => stop(s) }
}
/** The script's template: the sample on the day (UNDATED's on the sample's), with Vaultite's own plugins (but ALONE's). */
const variant = (name: string): Variant => ({ day: UNDATED.has(name) ? ANCHOR : localToday(), plugins: !ALONE.has(name), official: OFFICIAL })

/** Node running `args` in the checkout, in the caller's QA slot: its exit code and output, killed after TIMEOUT. */
async function exec(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env, VAULTITE_QA_SLOT: "1" } })
  let text = ""
  child.stdout.on("data", (b) => { text += b })
  child.stderr.on("data", (b) => { text += b })
  // (its tree, not just it: Playwright answers SIGTERM by closing its browser, which waits on one that hung)
  const timer = setTimeout(() => { text += `\n(timed out after ${TIMEOUT / 60_000} min)`; killTree(child.pid!) }, TIMEOUT)
  const code = await new Promise<number | null>((r) => child.on("close", r))
  clearTimeout(timer)
  return { code, text }
}

/** The web demo (demo.mjs): no server of ours (it's in the browser), on a build made for the run, never a stale one,
 *  with Vaultite's own plugins built in as vaultite.com builds it. */
async function demo(): Promise<Ran> {
  const t = Date.now(), env = { VAULTITE_PLUGINS: OFFICIAL }
  const built = await exec([path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "-c", "vite.demo.config.ts", "--logLevel", "warn"], env)
  const setup = Date.now() - t
  if (built.code !== 0) return { ok: false, setup, script: 0, out: `npm run build:demo failed:\n${built.text}` }
  const { code, text } = await exec([path.join(QA, "demo.mjs")], env)
  return { ok: code === 0, setup, script: Date.now() - t - setup, out: text }
}

/** A script's run: whether it passed, its output, and its time setting up (`template`: of it, the template's) and running. */
type Ran = { ok: boolean, out: string, skipped?: string, setup: number, script: number, template?: number }
async function run(name: string): Promise<Ran> {
  if (name === "demo") return demo()
  const mark = `${name}-${process.pid}-${Date.now()}`
  const r = await setUpAndRun(name, mark)
  // (what the script started that outlived it and its teardown, a desktop app's keepers say: ended, and the run fails)
  const left = carrying(mark)
  if (!left.length) return r
  await endAll(left)
  return { ...r, ok: false, out: `${r.out}\nFAIL left ${left.length} process${left.length > 1 ? "es" : ""} running: ${left.map((x) => `${x.pid} ${x.command.slice(0, 120)}`).join("; ")}` }
}
async function setUpAndRun(name: string, mark: string): Promise<Ran> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `vaultite-qa-${name}-`))
  const out = path.join(tmp, "out"), claude = claudeHome(path.join(tmp, "claude"))
  fs.mkdirSync(out)
  const servers: Server[] = []
  const began = Date.now()
  let setup = 0, made = 0
  try {
    const from = await template(variant(name), boot)
    made = Date.now() - began
    const { vault, local, repos } = copyTemplate(from, tmp)
    const env = envFor(claude, repos)
    if ((usage(name) as string[]).includes("<plugin index>")) Object.assign(env, { VAULTITE_PLUGIN_INDEX: path.join(tmp, "index.json"), VAULTITE_GITHUB: `file://${repos}` })
    const main = await serve(vault, local, env)
    servers.push(main)
    const args: string[] = []
    for (const tok of usage(name)) {
      const t = tok.slice(1, -1).replace(/^<|>$/g, "")
      if (/^fresh base url$/.test(t)) {
        fs.mkdirSync(path.join(tmp, "fresh"))
        const fresh = await serve(path.join(tmp, "fresh"), path.join(tmp, "fresh-local"), env)
        servers.push(fresh)
        args.push(fresh.base)
      } else if (/^fresh vault path$/.test(t)) args.push(path.join(tmp, "fresh"))
      else if (/base( url)?$/.test(t)) args.push(main.base)
      else if (t === "vault path") args.push(vault)
      else if (t === "vault copy") { fs.cpSync(vault, path.join(tmp, "copy"), { recursive: true }); args.push(path.join(tmp, "copy")) }
      else if (/^claude dir$/.test(t)) args.push(claude)
      else if (t === "plugin index") args.push(path.join(tmp, "index.json"))
      else if (t === "plugin repos") args.push(path.join(tmp, "repos"))
      else if (/(out|shots|screenshots) dir$/.test(t)) args.push(out)
      else if (tok.startsWith("[")) break
      else return { ok: true, out: "", skipped: `needs ${tok}`, setup: Date.now() - began, script: 0 }
    }
    setup = Date.now() - began
    const { code, text } = await exec([path.join(QA, `${name}.mjs`), ...args], { ...env, QA_BASE: main.base, VAULTITE_URL: main.base.slice(0, -1), [MARK]: mark })
    const skipped = code === 0 ? /^skipped: (.*)$/m.exec(text)?.[1] : undefined
    return { ok: code === 0, out: text, skipped, setup, script: Date.now() - began - setup, template: made }
  } catch (e) {
    return { ok: false, out: String(e), setup: setup || Date.now() - began, script: setup ? Date.now() - began - setup : 0, template: made }
  } finally {
    await Promise.all(servers.map(stop))
    // (a server still exiting may write one last file: retried, and a leftover temp folder never ends the run)
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* the OS's temp cleanup */ }
  }
}

// One copy of a script at a time: some use fixed ports or session names.
const queue = Array.from({ length: repeat }, () => names).flat()
const running = new Set<string>()
const next = () => { const i = queue.findIndex((n) => !running.has(n)); return i < 0 ? null : queue.splice(i, 1)[0] }
const fails: string[] = []
const runs = new Map<string, boolean[]>(), times = new Map<string, number>(), t0 = Date.now()
const spent = { setup: 0, script: 0, waited: 0, waits: 0 }
const sec = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
await Promise.all(Array.from({ length: jobs }, async () => {
  while (queue.length) {
    const name = next()
    if (!name) { await sleep(1000); continue }
    running.add(name)
    // (this machine's QA slot, shared with other agents' runs, held for the script and its servers)
    // (and on a Mac the front window, for one that brings its own forward: after the slot, so no two wait on each other)
    const asked = Date.now(), release = await slot(name), out = process.platform === "darwin" && FRONT.has(name) ? await front(name) : () => {}
    const waited = Date.now() - asked
    const r = await run(name).finally(() => { out(); release() })
    running.delete(name)
    Object.assign(spent, { setup: spent.setup + r.setup, script: spent.script + r.script, waited: spent.waited + waited, waits: spent.waits + (waited >= 1000 ? 1 : 0) })
    if (r.skipped) { console.log(`skip ${name} (${r.skipped})`); continue }
    runs.set(name, [...runs.get(name) ?? [], r.ok])
    times.set(name, r.setup + r.script)
    // (where its time went: setting up, the script, and waiting for this machine's slot or for the template to be made)
    const more = [(r.template ?? 0) >= 1000 && `template ${sec(r.template!)}`, waited >= 1000 && `slot wait ${sec(waited)}`].filter(Boolean)
    console.log(`${r.ok ? "ok  " : "FAIL"} ${name} (${sec(r.setup + r.script)}: setup ${sec(r.setup)}, script ${sec(r.script)}${more.length ? `; ${more.join(", ")}` : ""})`)
    // (what failed, and the last check that passed: where a script that threw got to)
    const lines = r.out.trim().split("\n"), lastOk = lines.findLastIndex((l) => l.startsWith("ok"))
    if (!r.ok) fails.push(`--- ${name}\n${lines.filter((l, i) => i === lastOk || !l.startsWith("ok")).slice(-25).join("\n")}`)
    // (on GitHub, each failed script an annotation, its first failed check: what main's red notice names, tools/mainci.ts)
    if (!r.ok && process.env.GITHUB_ACTIONS) {
      const why = (lines.find((l) => l.startsWith("FAIL ")) ?? lines.findLast((l) => l.trim()) ?? "failed").replace(/^FAIL\s+/, "").split("  (got ")[0].slice(0, 300)
      console.log(`::error title=qa ${name}::${why.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`)
    }
  }
}))
record("qa", [...runs].map(([name, rs]) => ({ name, ms: times.get(name) ?? 0, ok: rs.every(Boolean), fails: rs.every(Boolean) ? [] : [name] })), Date.now() - t0)
const flaky = [...runs].filter(([, rs]) => rs.includes(true) && rs.includes(false)).map(([n]) => n)
if (fails.length) console.log(`\n${fails.join("\n\n")}`)
console.log(`\n${[...runs.values()].flat().filter(Boolean).length}/${[...runs.values()].flat().length} runs passed` +
  (flaky.length ? `; flaky: ${flaky.join(", ")}` : "") + ` in ${sec(Date.now() - t0)}; summed over them: setup ${sec(spent.setup)}, scripts ${sec(spent.script)}, ` +
  `slot waits ${sec(spent.waited)}${spent.waits ? ` (${spent.waits} waited)` : ""}`)
process.exit(fails.length ? 1 : 0)
