// The app's identity and build facts, by owner: the installed app's (electron/shell.json: its name, id, channel, shell
// fingerprint, the commit it was built from) and the code's (electron/build.json: commit and repo). No Electron imports.
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const SHELL_STAMP = z.object({ channel: opt(z.enum(["dev", "nightly", "main"])), release: opt(z.boolean()), branch: opt(z.string()), commit: opt(z.string()),
  fingerprint: opt(z.string()), appId: opt(z.string()), productName: opt(z.string()) }).catch({})
/** The installed app's: stamp.ts writes its channel, sign.cjs (afterPack) the name and id it was packaged as. */
export type Shell = z.infer<typeof SHELL_STAMP>
/** The shell that started this process (electron/shell/boot.mjs): the code root it picked, and its record of it. */
export type ShellHost = { root: string; bundleRoot: string; shell: Shell; from: string
  /** The first window's server answered (or, with none, the launch is done). */
  ready(): void
  /** What happened since last asked: a root passed over, an earlier run that failed (electron/shell/roots.mjs). */
  events(): { t: number; kind: string; root: string; commit: string | null; why: string; ran?: string }[] }
const CODE_STAMP = z.object({ commit: z.string(), repo: z.string() })
/** The code's: which commit of which repo it is. */
export type Code = z.infer<typeof CODE_STAMP>

const ROOT = path.dirname(import.meta.dirname)
const read = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null } }

/** The shell's stamp at `root` ({} for a checkout run as it is, or a build that wasn't stamped). */
export const shellAt = (root: string): Shell => SHELL_STAMP.parse(read(path.join(root, "electron", "shell.json")))

/** The code's stamp at `root` (null: none, or one without its commit and repo). */
export const codeAt = (root: string): Code | null => CODE_STAMP.safeParse(read(path.join(root, "electron", "build.json"))).data ?? null

/** What stamp.ts writes for a build of `commit` (on `branch`), as the build's env says. */
export function stamps(o: { commit: string; repo: string; branch: string; fingerprint: string; env: Record<string, string | undefined> }): { code: Code; shell: Shell } {
  const { VAULTITE_RELEASE: release, VAULTITE_CHANNEL: channel } = o.env
  return { code: { commit: o.commit, repo: o.repo }, shell: {
    ...(release ? { release: true } : {}),
    ...(channel === "dev" ? { channel, branch: o.branch } : channel === "nightly" || channel === "main" ? { channel } : {}),
    commit: o.commit, fingerprint: o.fingerprint } }
}

/** In the app, its shell; null elsewhere (tools, tests). */
declare global { var vaultiteShell: ShellHost | undefined }
export const HOST = globalThis.vaultiteShell ?? null
/** The running shell's stamp; outside the app, the one beside this code. */
export const SHELL = HOST?.shell ?? shellAt(ROOT)
export const CODE = codeAt(ROOT)
/** A Vaultite Dev instance's worktree (the shell picked VAULTITE_CODE_ROOT: electron/dev.ts), null otherwise. */
export const WORKTREE = HOST?.from === "dev" ? HOST.root : null
/** Vaultite Dev, and the branch it updates from. */
export const DEV = SHELL.channel === "dev"
export const BRANCH = (DEV && SHELL.branch) || "main"
