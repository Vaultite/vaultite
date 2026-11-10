// A service install following a branch (`vau service install --updates main`: VAULTITE_UPDATES in the job's env, so
// this machine's choice, not the vault's): the commit core/update/ picks is merged, built, and run by a restart.
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { gitIn, isAncestor, short } from "./update/git.ts"
import { fixSpawnHelper } from "./update/npm.ts"
import type { Update, UpdaterOptions } from "./update/updater.ts"
import { errText } from "./update/updater.ts"

const exec = promisify(execFile)
const MINUTE = 60_000

/** Whether a change reaches the running server (and so needs a restart): anything but what's built into web/dist or
 *  never loaded by it (the desktop and iOS apps, tools, CI, docs for people). */
export const backendChanged = (files: string[]) => files.some((f) =>
  !/^(web|electron|ios|tools|screenshots|examples|\.github|\.githooks)\//.test(f) && !/\.(tsx|css)$/.test(f) && !/^[^/]+\.md$/.test(f))

export type InPlaceOptions = Omit<UpdaterOptions, "apply"> & {
  /** Runs npm (install, run build) in the checkout. */
  npm?: (args: string[]) => Promise<unknown>
}

/** The updater for the service's own checkout: a commit is fast-forwarded to and built where the server runs (installed
 *  when the lock changed), and the server restarts only when the change reaches it. */
export function inPlace({ npm: npmIn, ...o }: InPlaceOptions): UpdaterOptions {
  const git = gitIn(o.root)
  // (Windows' npm is npm.cmd, which only a shell runs; the arguments are fixed words)
  const npm = npmIn ?? ((args: string[]) => exec("npm", args, { cwd: o.root, timeout: 30 * MINUTE, maxBuffer: 64 << 20, shell: process.platform === "win32", windowsHide: true }))
  const apply = async ({ head, running, to, files }: Update) => {
    const lock = files.includes("package-lock.json")
    const install = async () => {
      await npm(["install", "--no-audit", "--no-fund"])
      fixSpawnHelper(path.join(o.root, "node_modules"))
      await git("checkout", "--", "package-lock.json") // (npm may rewrite it: the tree stays clean for the next update)
    }
    try {
      if (head !== to) await git("merge", "--ff-only", "--quiet", to)
      if (lock) await install()
      await npm(["run", "build"])
    } catch (e) {
      // Back to what runs, built as it was: never half-updated.
      let back = ""
      const was = await isAncestor(git, running, head) ? running : head
      try {
        if (await git("rev-parse", "HEAD") !== was) {
          await git("reset", "--hard", "--quiet", was)
          if (lock) await install()
          await npm(["run", "build"])
        }
      } catch (e2) { back = `, and going back to ${short(was)} failed too: ${errText(e2)}` }
      return { failed: `${short(to)} didn't install or build: ${errText(e)}${back}`, cause: e }
    }
    const restart = backendChanged(files)
    await shadow(o.root, files, restart, o.log ?? console.log)
    return { restart }
  }
  return { ...o, apply }
}

/** The module graph's answer beside backendChanged's (core/update/closure.ts), said when they differ: evidence before
 *  the graph decides anything. The update acts on backendChanged. */
export async function shadow(root: string, files: string[], restart: boolean, log: (line: string) => void) {
  try {
    const { diskTree, graphOf } = await import("./update/closure.ts")
    const g = graphOf(diskTree(root)), hit = g.hit("server", files)
    if (!!hit === restart) return
    const list = (xs: string[]) => `${xs.slice(0, 5).join(", ")}${xs.length > 5 ? ` and ${xs.length - 5} more` : ""}`
    const reached = files.filter((f) => g.reach("server").files.has(f))
    log(restart
      ? `vaultite: updates: the module graph would not restart (the server reaches none of ${list(files.filter((f) => backendChanged([f])))}); restarting, as the folder rule says`
      : `vaultite: updates: the module graph would restart (${hit!.unknown ? `it can't follow ${hit!.unknown.file}:${hit!.unknown.line}: ${hit!.unknown.text}`
        : `${list(reached)}; ${hit!.chain.join(" > ")}`}); not restarting, as the folder rule says`)
  } catch (e) { log(`vaultite: updates: the module graph failed: ${errText(e)}`) }
}
