import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { gitIn, isAncestor, short } from "./update/git.ts"
import { fixSpawnHelper } from "./update/npm.ts"
import type { Update, UpdaterOptions } from "./update/updater.ts"
import { graphModule } from "./update/graph.ts"
import { errText, toLog } from "./update/updater.ts"

const exec = promisify(execFile)
const MINUTE = 60_000

export const backendChanged = (files: string[]) => files.some((f) =>
  !/^(web|electron|ios|tools|screenshots|examples|\.github|\.githooks)\//.test(f) && !/\.(tsx|css)$/.test(f) && !/^[^/]+\.md$/.test(f))

export type InPlaceOptions = Omit<UpdaterOptions, "apply"> & {
  npm?: (args: string[]) => Promise<unknown>
}

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
    await shadow(o.root, files, restart, o.log ?? toLog)
    return { restart }
  }
  return { ...o, apply, restarts: backendChanged }
}

/** Logs where the module graph disagrees with backendChanged; the update acts on backendChanged. */
export async function shadow(root: string, files: string[], restart: boolean, log: (line: string) => void) {
  const mod = graphModule()
  if (!mod) return
  try {
    const { diskTree, graphOf } = await mod
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
