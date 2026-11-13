// The store's updates' work (storehost.ts loads it at the first look, not with every launch: tools/perf/startup.ts): a
// look as the service's, a commit prepared and acted on by its plan, a new shell built, a launch's root kept.
import { app } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { gitEnv } from "../core/gitenv.ts"
import { holdRoot } from "../core/update/lease.ts"
import { stopRuns, type Recipe, type Root, type RootStore } from "../core/update/store.ts"
import type { Applied, Update, UpdaterOptions } from "../core/update/updater.ts"
import { BRANCH, CODE, HOST, SHELL } from "./identity.ts"
import { mainLog } from "./mainlog.ts"
import { readJson, SHA, type StoreHost, userData } from "./storehost.ts"
import { policyFor, SHELL_EVERY, storeDir } from "./storepolicy.ts"
import { messageOf } from "./browser/errors.ts"
import { atExit } from "../core/exit.ts"

const exec = promisify(execFile)
const ROOT = path.dirname(import.meta.dirname)
const engine = () => Promise.all([import("../core/update/store.ts"), import("../core/update/updater.ts"), import("../core/update/plan.ts")])
  .then(([store, updater, plan]) => ({ ...store, ...updater, ...plan }))
const errText = (e: unknown) => String((e as { stderr?: string }).stderr || messageOf(e) || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)

let opts: UpdaterOptions | null = null
async function storeOf(h: StoreHost, recipe?: Recipe): Promise<RootStore> {
  const { rootStore } = await engine()
  return rootStore({ dir: storeDir(userData()), url: CODE!.repo, ...(recipe ? { recipe } : {}), node: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH: h.path() }, log: h.log })
}

/** One look, as the service's: fetched into the store's clone, the commit to take (policyFor) prepared and acted on. */
export async function look(h: StoreHost) {
  const { checkForUpdate: lookOnce, updateStatus } = await engine()
  const server = await h.attached()
  if (server === null) { h.log("store: a server its windows attach to didn't say its commit: looking again later"); return updateStatus() }
  const p = await policyFor(server), store = await storeOf(h, p.recipe)
  if (p.follows !== follows) { follows = p.follows; h.log(`store: follows ${server ? `the commit its server runs (${server.slice(0, 7)})` : "the branch's newest"}`) }
  // (the clone update.sh built in, moved in: its objects, no download)
  await store.init(path.join(userData(), "source.noindex"))
  opts ??= { root: store.repo, bare: true, branch: BRANCH, running: CODE!.commit, stateFile: path.join(userData(), "store-updates.json"),
    busy: h.busy, restart: () => {}, log: (line, e) => h.log(e === undefined ? line : `${line}: ${errText(e)}`), apply: async () => ({ restart: false }) }
  opts.root = store.repo
  opts.ci = p.ci
  // (busy, an agent at work in the browser, never holds a root being made: only its servers' restart waits, below)
  opts.restarts = () => false
  opts.apply = (u) => apply(h, store, u)
  const s = await lookOnce(opts)
  for (const fn of afterLook.splice(0)) setTimeout(fn, 500)
  return s
}
let follows = ""
/** Its servers restarted onto the current root once nothing a restart cuts short runs, once however many updates ask. */
let restartWaits: Promise<void> | null = null, preparing = 0
atExit(() => { const left = stopRuns("SIGKILL"); if (left) mainLog(`quit: ${left} process(es) a prepare still ran stopped`) })
function restartWhenIdle(h: StoreHost) {
  if (restartWaits) return h.log("store: its servers restart once idle, as already asked")
  const why = async () => (preparing ? "a commit is being prepared" : h.busy())
  restartWaits = (async () => {
    for (let busy = await why(), said = false; busy; busy = await why()) {
      if (!said) { said = true; h.log(`store: its servers restart once idle (${busy})`) }
      await new Promise((r) => setTimeout(r, preparing ? 5000 : 30_000))
    }
  })().catch((e) => h.log(`store: whether it's idle wasn't told (${errText(e)}): its servers restart now`))
    .finally(() => { restartWaits = null; h.restartServers() })
}
const afterLook: (() => void)[] = []

/** When the last shell was built (kept across launches: a relaunch doesn't build again at once). */
const SHELL_AT = () => path.join(userData(), "shell-built")

async function apply(h: StoreHost, store: RootStore, u: Update): Promise<Applied> {
  let r: Root
  preparing++
  mainLog(`store: preparing ${u.to.slice(0, 7)}`)
  try { r = await store.prepare(u.to) } catch (e) {
    mainLog(`store: ${u.to.slice(0, 7)} wasn't prepared: ${errText(e)}`)
    return { failed: errText(e), cause: e }
  } finally { preparing-- }
  mainLog(`store: prepared ${u.to.slice(0, 7)}`)
  if (r.fingerprint !== SHELL.fingerprint) {
    // (a new shell: the app built and signed again, from this root, then put in place as before)
    const at = Number(readJson<number>(SHELL_AT())) || 0
    if (Date.now() - at < SHELL_EVERY) throw new Error(`${u.to.slice(0, 7)} needs a new shell, built at most hourly: the next after ${new Date(at + SHELL_EVERY).toLocaleTimeString()}`)
    fs.writeFileSync(SHELL_AT(), String(Date.now()))
    try { await buildShell(h, r) } catch (e) { return { failed: `its new shell didn't build: ${errText(e)}`, cause: e } }
    // (the new shell's fingerprint is this root's: it runs it once installed)
    await store.setCurrent(u.to)
    h.offerInstall(u.to)
    return { restart: false, said: "the app is built again (its shell changed): a restart puts it in place" }
  }
  await store.setCurrent(u.to)
  const { planUpdate } = await engine()
  const s = h.servers(), main = CODE!.commit, helper = h.helper()
  const froms = [...new Set([main, helper, s?.code, s?.web].filter((c): c is string => !!c))]
  const changed = Object.fromEntries(await Promise.all(froms.map(async (from) =>
    [from, await exec("git", ["-C", store.repo, "diff", "--name-only", "--no-renames", from, u.to], { env: gitEnv(), maxBuffer: 16 << 20 })
      .then((o) => o.stdout.split("\n").filter(Boolean), () => null)] as const)))
  let graph = null
  try { const { diskTree, graphOf } = await import("../core/update/closure.ts"); graph = graphOf(diskTree(r.dir)) } catch (e) { h.log(`store: no module graph for ${u.to.slice(0, 7)}: ${errText(e)}`) }
  const plan = planUpdate({ to: u.to, changed, graph, shell: { running: SHELL.fingerprint ?? null, root: r.fingerprint },
    running: { main, helper, ...(s ? { server: s.code && s.web ? { code: s.code, web: s.web } : null, ui: s.web } : {}) } })
  h.log(`store: ${u.to.slice(0, 7)} is current: ui ${plan.ui}, server ${plan.server}, main ${plan.main}, helper ${plan.helper}${Object.entries(plan.why).map(([k, w]) => `; ${k}: ${w}`).join("")}`)
  // (once the look has answered: a `vau update` asked through a server that restarts gets its answer first)
  afterLook.push(() => {
    if (plan.server === "restart") restartWhenIdle(h)
    else if (plan.server === "adopt-web") h.adoptWeb(path.join(r.dir, "web", "dist"), u.to)
    if (plan.main === "relaunch") h.offerRelaunch(u.to, plan.why.main)
    // (once idle: never mid-press, dictation or voice; helperload.ts)
    else if (plan.helper === "reload") h.reloadHelper(r.dir, u.to)
    void store.gc().catch((e) => h.log(`store: gc failed: ${errText(e)}`))
  })
  const said = [plan.server === "restart" ? "its servers restart" : plan.server === "adopt-web" ? "its pages take the new web app" : "",
    plan.main === "relaunch" ? "a relaunch runs it in the app" : plan.helper === "reload" ? "the menu-bar helper reloads onto it" : ""].filter(Boolean).join("; ") || "nothing it runs changed"
  return { restart: false, said }
}

/** The app built from prepared root `r` (its web build, helpers and stamps there already) into update.noindex, as
 *  update.sh build leaves it: in a copy that shares the root's blocks, its packages linked from the store. */
async function buildShell(h: StoreHost, r: Root) {
  const next = path.join(userData(), "update.noindex"), work = path.join(next, `build-${r.commit}`)
  const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => exec(cmd, args, { cwd: work, maxBuffer: 64 << 20, timeout: 45 * 60_000,
    env: { ...process.env, PATH: h.path(), ...env } })
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(next, { recursive: true })
  h.log(`store: building a new shell from ${r.commit.slice(0, 7)}`)
  // (APFS clones, Linux reflinks where it can: the root's blocks shared)
  await exec("cp", process.platform === "darwin" ? ["-cR", r.dir, work] : ["-R", "--reflink=auto", r.dir, work])
  try {
    await exec("chmod", ["-R", "u+w", work])
    const deps = path.resolve(r.dir, fs.readlinkSync(path.join(r.dir, "node_modules")))
    fs.rmSync(path.join(work, "node_modules"))
    fs.symlinkSync(deps, path.join(work, "node_modules"))
    // (VAULTITE_UPDATING: sign.cjs fails rather than sign ad hoc, which would cost every privacy grant and sign-in; the
    // user's node, as npm runs it: as the app's binary, its argument parser takes itself for a packaged app's)
    await run("node", [path.join(work, "node_modules", "electron-builder", "cli.js"), "--dir", "-c", "electron/source.cjs"], { VAULTITE_UPDATING: "1" })
    const name = app.getName(), out = path.join(work, "dist-app")
    const made = fs.readdirSync(out).map((d) => path.join(out, d, process.platform === "darwin" ? `${name}.app` : "")).find((p) => /\.app$|-unpacked\/?$/.test(p) && fs.existsSync(p))
    if (!made) throw new Error("electron-builder made no app")
    const to = path.join(next, process.platform === "darwin" ? `${name}.app` : name)
    fs.rmSync(to, { recursive: true, force: true })
    fs.rmSync(path.join(next, "commit"), { force: true })
    fs.renameSync(made, to)
    fs.writeFileSync(path.join(next, "commit"), `${r.commit}\n`)
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
  h.log(`store: the new shell for ${r.commit.slice(0, 7)} is built`)
}

/** Once this launch is ready: its store root good, and held while it lives; the shell's bad marks the store's too; then
 *  roots no one holds go (after the shell's minute to count a crash of this start). */
export async function ready(h: StoreHost) {
  const store = await storeOf(h), here = HOST?.root ?? ROOT, sha = path.basename(here)
  if (HOST && (HOST.from === "current" || HOST.from === "good") && SHA.test(sha)) {
    try { store.markGood(sha) } catch (e) { h.log(`store: ${sha.slice(0, 7)} not marked good: ${errText(e)}`) }
    void holdRoot(path.join(here, "electron", "main.ts"), "main")
  }
  const bad = readJson<Record<string, { why: string }>>(path.join(userData(), "shell", "bad.json")) ?? {}
  for (const [root, b] of Object.entries(bad)) {
    const c = path.basename(root)
    if (path.dirname(root) === path.join(store.dir, "roots") && SHA.test(c) && !store.bad(c)) store.markBad(c, `it didn't start: ${b.why}`)
  }
  setTimeout(() => void store.gc().catch((e) => h.log(`store: gc failed: ${errText(e)}`)), 70_000).unref()
}
