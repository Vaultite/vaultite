import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { gitEnv } from "../gitenv.ts"
import type { Applied, Update, UpdaterOptions } from "./updater.ts"
import { errText, toLog } from "./updater.ts"
import { rootStore, serverRecipe, type Recipe, type RootStore } from "./store.ts"
import { planUpdate } from "./plan.ts"
import { graphModule } from "./graph.ts"

const exec = promisify(execFile)

export type StoreServiceOptions = Omit<UpdaterOptions, "apply" | "root" | "bare" | "running"> & {
  /** The checkout the service was installed from: its origin, and its objects for the store's first clone. */
  checkout: string
  store: string
  /** The root this server runs (its ROOT): the commit it runs, and the web build it serves till it takes another. */
  root: string
  /** Serve another root's web build from now on (server.ts' web.adopt). */
  adoptWeb: (dist: string) => void
  /** Default npm and serverRecipe. */
  install?: (dir: string, o: { fresh: boolean }) => Promise<void>
  recipe?: Recipe
}

const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args], { env: gitEnv(), maxBuffer: 16 << 20 }).then((r) => r.stdout.trim())

export async function inStore({ checkout, store: dir, root, adoptWeb, install, recipe, ...o }: StoreServiceOptions): Promise<UpdaterOptions> {
  const log = o.log ?? toLog
  const url = await git(checkout, "remote", "get-url", "origin")
  const store: RootStore = rootStore({ dir, url, recipe: recipe ?? serverRecipe(), node: process.execPath, log, ...(install ? { install } : {}) })
  await store.init(checkout)
  const running = await git(root, "rev-parse", "HEAD")
  // (what started on a root runs well: it's what a crash at start falls back to, bin/vaultite-server)
  if (store.prepared(running)) store.markGood(running)
  let web = running
  const apply = async (u: Update): Promise<Applied> => {
    let r
    try { r = await store.prepare(u.to) } catch (e) { return { failed: errText(e), cause: e } }
    try { await store.setCurrent(u.to) } catch (e) { return { failed: errText(e), cause: e } }
    const froms = [...new Set([running, web])]
    const changed = Object.fromEntries(await Promise.all(froms.map(async (from) =>
      [from, await git(store.repo, "diff", "--name-only", "--no-renames", from, u.to).then((s) => s.split("\n").filter(Boolean), () => null)] as const)))
    let graph = null
    const mod = graphModule()
    try { if (mod) { const { diskTree, graphOf } = await mod; graph = graphOf(diskTree(r.dir)) } } catch (e) { log(`store: no module graph for ${u.to.slice(0, 7)}: ${errText(e)}`) }
    // (the service runs on Node, not a shell: its fingerprint never asks for one)
    const plan = planUpdate({ to: u.to, changed, graph, shell: { running: r.fingerprint, root: r.fingerprint }, running: { server: { code: running, web } } })
    log(`store: ${u.to.slice(0, 7)} is current: server ${plan.server}${plan.why.server ? `; ${plan.why.server}` : ""}`)
    void store.gc().catch((e) => log(`store: gc failed: ${errText(e)}`))
    if (plan.server === "restart") return { restart: true, said: "restarting onto its root" }
    if (plan.server === "adopt-web") { adoptWeb(path.join(r.dir, "web", "dist")); web = u.to; return { restart: false, said: "its pages take the new web app" } }
    return { restart: false, said: "nothing the server runs changed" }
  }
  // (a root is made while agents browse: only its restart waits for them, the updater's quiet wait)
  return { ...o, root: store.repo, bare: true, running, restarts: () => false, apply }
}
