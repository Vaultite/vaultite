import { strings } from "./values.ts"

/** A lock entry's `history` line. `notes`: its commits' subjects since the version it replaced. */
export type Update = { from: string; to: string; at: string; how: "auto" | "manual" | "rollback"; notes: string[] }

/** Which installed plugins update on their own: Vaultite's (the default), all of them, or none. */
export type UpdatePolicy = "vaultite" | "all" | "off"
const POLICIES: UpdatePolicy[] = ["vaultite", "all", "off"]

export function official(source: string) {
  return /^vaultite\//i.test(source) || /^(https:\/\/(www\.)?github\.com\/|(ssh:\/\/)?git@github\.com[/:])vaultite\//i.test(source)
}

/** plugins.json's keys about updates. */
export type UpdateConfig = { updates?: unknown; updatesOn?: unknown; updatesOff?: unknown }

export const policyOf = (c: UpdateConfig): UpdatePolicy => (POLICIES.includes(c.updates as UpdatePolicy) ? c.updates as UpdatePolicy : "vaultite")

/** Whether a source can update at all: not a folder on this machine (its author's work) nor a zip (one version). */
export const updatable = (source: string) => !/^(\/|~\/|\.\.?\/)/.test(source) && !/#sha256=/i.test(source)

export const byPolicy = (c: UpdateConfig, source: string) => { const p = policyOf(c); return p === "all" || (p === "vaultite" && official(source)) }

export function autoUpdates(c: UpdateConfig, id: string, source: string) {
  if (!updatable(source) || strings(c.updatesOff).includes(id)) return false
  return strings(c.updatesOn).includes(id) || byPolicy(c, source)
}

const QUIET = new Set(["chore", "test", "tests", "ci", "build", "docs", "style"])
const NOTES_MAX = 8

export function notesOf(subjects: string[]): string[] {
  const out: string[] = []
  for (const s of subjects) {
    const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())
    if (m && QUIET.has(m[1].toLowerCase())) continue
    const text = (m ? m[2] : s).trim()
    if (!text || /^merge /i.test(text)) continue
    const line = text[0].toUpperCase() + text.slice(1)
    if (!out.includes(line)) out.push(line)
  }
  return out.slice(-NOTES_MAX)
}
