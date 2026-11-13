import fs from "node:fs"
import path from "node:path"
import { codeOf } from "./values.ts"

/** A new project's settings as Claude Code makes them (it reads some without checking they're there). */
export const NEW_PROJECT = { allowedTools: [], mcpContextUris: [], mcpServers: {}, enabledMcpjsonServers: [], disabledMcpjsonServers: [], hasTrustDialogAccepted: false,
  hasClaudeMdExternalIncludesApproved: false, hasClaudeMdExternalIncludesWarningShown: false }

type Project = Record<string, unknown>

/** Project `key`'s settings in `file` changed by `edit` (null: unchanged; whether it wrote), under Claude Code's lock
 *  (proper-lockfile's `<file>.lock`), so a running session's next write, reading it again under that lock, keeps it. */
export async function editClaudeProject(file: string, key: string, edit: (p: Project) => Project | null, named = file) {
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break } catch (e) {
      if (codeOf(e) !== "EEXIST") throw e
      // (stale after 10 s without an update, as proper-lockfile has it: a Claude that died holding it)
      if (Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 10_000) { fs.rmSync(lock, { recursive: true, force: true }); continue }
      if (i > 50) throw new Error("Claude Code is busy writing its settings: try again in a moment")
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  try {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    const j = text.trim() ? JSON.parse(text) : {}
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${named} isn't Claude Code's settings`)
    const next = edit(j.projects?.[key] ?? NEW_PROJECT)
    if (!next) return false
    j.projects = { ...j.projects, [key]: next }
    const tmp = `${file}.vaultite-${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: text ? fs.statSync(file).mode & 0o777 : 0o600 })
    fs.renameSync(tmp, file)
    return true
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

/** Marks folder `dir` trusted (Claude Code's "Trust this folder?" answered yes) in config `file`; whether it wasn't yet. */
export const trustClaudeProject = (file: string, dir: string) =>
  editClaudeProject(file, dir, (p) => (p.hasTrustDialogAccepted === true ? null : { ...p, hasTrustDialogAccepted: true }))
