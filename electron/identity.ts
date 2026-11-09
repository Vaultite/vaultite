// The app's identity and build facts, by owner: the installed app's (electron/shell.json: its name, id, channel and the
// commit it was built from) and its code's (electron/build.json: commit and repo). No Electron: tools/test_shell.ts runs it.
import fs from "node:fs"
import path from "node:path"

/** The installed app's: stamp.ts writes its channel, sign.cjs (afterPack) the name and id it was packaged as. */
export type Shell = { channel?: "dev" | "nightly" | "main"; release?: boolean; branch?: string; commit?: string; appId?: string; productName?: string }
/** The code's: which commit of which repo it is. */
export type Code = { commit: string; repo: string }

const ROOT = path.dirname(import.meta.dirname)
const read = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null } }

/** The shell's stamp at `root` ({} for a checkout run as it is, or a build that wasn't stamped). */
export function shellAt(root: string): Shell {
  const s = read(path.join(root, "electron", "shell.json"))
  return s && typeof s === "object" ? s as Shell : {}
}

/** The code's stamp at `root` (null: none, or one without its commit and repo). */
export function codeAt(root: string): Code | null {
  const c = read(path.join(root, "electron", "build.json")) as Partial<Code> | null
  return typeof c?.commit === "string" && typeof c.repo === "string" ? { commit: c.commit, repo: c.repo } : null
}

/** What stamp.ts writes for a build of `commit` (on `branch`), as the build's env says. */
export function stamps(o: { commit: string; repo: string; branch: string; env: Record<string, string | undefined> }): { code: Code; shell: Shell } {
  const { VAULTITE_RELEASE: release, VAULTITE_CHANNEL: channel } = o.env
  return { code: { commit: o.commit, repo: o.repo }, shell: {
    ...(release ? { release: true } : {}),
    ...(channel === "dev" ? { channel, branch: o.branch } : channel === "nightly" || channel === "main" ? { channel } : {}),
    commit: o.commit } }
}

export const SHELL = shellAt(ROOT)
export const CODE = codeAt(ROOT)
/** The app's name, and so its userData: each build named otherwise (Main, Dev, Nightly, a test release) keeps its own. */
export const NAME = SHELL.productName ?? "Vaultite"
/** Windows' AppUserModelID for it (its Start menu shortcut's, so notifications are its); unset from source. */
export const APP_ID = SHELL.appId ?? null
/** Vaultite Dev, and the branch it updates from. */
export const DEV = SHELL.channel === "dev"
export const BRANCH = (DEV && SHELL.branch) || "main"
