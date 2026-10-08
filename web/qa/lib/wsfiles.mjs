// Workspaces' files for a QA run (plugins/core/workspaces: a file each, .vaultite/plugins/workspaces/<n>.json, and its
// data.json): read as the list they make, cleared, or set aside for the run and put back after.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const wsDir = (vault) => path.join(vault, ".vaultite/plugins/workspaces")
const slotFile = (vault, n) => path.join(wsDir(vault), `${n}.json`)

/** The workspaces as the list they make (null: unused), trailing unused ones left out. */
export function workspaces(vault) {
  const list = [1, 2, 3, 4, 5].map((n) => { try { return JSON.parse(readFileSync(slotFile(vault, n), "utf8")) } catch { return null } })
  while (list.length && list[list.length - 1] === null) list.pop()
  return list
}

/** When they last changed (ms; 0: there are none). */
export const wsChanged = (vault) => Math.max(0, ...[1, 2, 3, 4, 5].map((n) => { try { return statSync(slotFile(vault, n)).mtimeMs } catch { return 0 } }))

/** No workspaces (every file gone). */
export const clearWorkspaces = (vault) => rmSync(wsDir(vault), { recursive: true, force: true })

/** Set them aside for the run (none meanwhile): the function puts them back as they were. */
export function setAsideWorkspaces(vault) {
  const dir = wsDir(vault), keep = mkdtempSync(path.join(os.tmpdir(), "qa-workspaces-")), had = existsSync(dir)
  if (had) { cpSync(dir, keep, { recursive: true }); clearWorkspaces(vault) }
  return () => { clearWorkspaces(vault); if (had) cpSync(keep, dir, { recursive: true }); rmSync(keep, { recursive: true, force: true }) }
}
