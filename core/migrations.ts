// A vault's settings brought up to date when the app's defaults change under them, once: a step's id goes in
// .vaultite/migrations.json when it has run (a synced vault's other machine skips it); a new vault starts with all done.
import type { Vault } from "./vault.ts"

const FILE = "migrations"

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

/** Built-ins that were on from the start (`essential`) and became `offByDefault`: on where they weren't switched off. */
export const NOW_OPT_IN = ["activity", "dispatch", "token-count", "workspaces", "codex", "cursor", "opencode", "openclaw", "hermes"]

const STEPS: { id: string; run: (v: Vault) => void }[] = [
  {
    id: "plugins-opt-in-2026-10",
    run: (v) => {
      const conf = v.readConfig("plugins") ?? {}
      const disabled = strs(conf.disabled), enabled = strs(conf.enabled)
      const on = NOW_OPT_IN.filter((id) => !disabled.includes(id) && !enabled.includes(id))
      // (`disabled` no longer counts for them: off is out of `enabled`)
      v.patchConfig("plugins", { disabled: disabled.filter((id) => !NOW_OPT_IN.includes(id)), enabled: [...enabled, ...on] })
    },
  },
]

/** Every step's id: what a vault made as the app's defaults are now has had (a new one, the sandbox). */
export const DONE = STEPS.map((s) => s.id)

/** Run the steps this vault hasn't had; a new vault (`fresh`) has them marked done. One that can't run now (a settings
 *  file iCloud holds) runs at the next start. */
export function migrate(v: Vault, fresh: boolean) {
  let done: string[]
  try { done = strs(v.readConfig(FILE)?.done) } catch { return }
  const todo = STEPS.filter((s) => !done.includes(s.id))
  if (!todo.length) return
  for (const s of todo) {
    if (!fresh) {
      try { s.run(v) } catch (e) { console.error(`bringing the vault's settings up to date (${s.id}):`, e); break }
    }
    done = [...done, s.id]
  }
  v.patchConfig(FILE, { done })
}
