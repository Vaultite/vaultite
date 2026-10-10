// Installed plugins updating on their own: which do (plugins.json's `updates`, and each plugin's own choice), and what's
// new in an update (its commits' subjects, as release notes). No Node and no imports of code: the web imports it too.

/** One update of an installed plugin (its lock entry's `history`): from and to which version, when, how (on its own, by
 *  hand, rolled back), and what's new in it (its commits' subjects since the version it replaced). */
export type Update = { from: string; to: string; at: string; how: "auto" | "manual" | "rollback"; notes: string[] }

/** Which installed plugins update on their own: Vaultite's (the default), all of them, or none. */
export type UpdatePolicy = "vaultite" | "all" | "off"
export const POLICIES: UpdatePolicy[] = ["vaultite", "all", "off"]

/** Whether a source is Vaultite's own (its GitHub organisation): what updates on its own unless the user says otherwise. */
export function official(source: string) {
  return /^vaultite\//i.test(source) || /github\.com[/:]vaultite\//i.test(source)
}

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

/** plugins.json's keys about updates. */
export type UpdateConfig = { updates?: unknown; updatesOn?: unknown; updatesOff?: unknown }

export const policyOf = (c: UpdateConfig): UpdatePolicy => (POLICIES.includes(c.updates as UpdatePolicy) ? c.updates as UpdatePolicy : "vaultite")

/** Whether a source can update at all: not a folder on this machine (its author's work) nor a zip (one version). */
export const updatable = (source: string) => !/^(\/|~\/|\.\.?\/)/.test(source) && !/#sha256=/i.test(source)

/** Whether the vault's policy alone has it update on its own. */
export const byPolicy = (c: UpdateConfig, source: string) => { const p = policyOf(c); return p === "all" || (p === "vaultite" && official(source)) }

/** Whether an installed plugin updates on its own: its own choice (plugins.json `updatesOn`, `updatesOff`), else the
 *  vault's policy. */
export function autoUpdates(c: UpdateConfig, id: string, source: string) {
  if (!updatable(source) || ids(c.updatesOff).includes(id)) return false
  return ids(c.updatesOn).includes(id) || byPolicy(c, source)
}

const QUIET = new Set(["chore", "test", "tests", "ci", "build", "docs", "style"])
export const NOTES_MAX = 8

/** Commit subjects as release notes, oldest first: a conventional prefix taken off ("feat(x): every app" is "Every app"),
 *  upkeep left out (chore, test, ci, build, docs), repeats once. */
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
