// Which file is the `vau` CLI's entry: what its shims, agents' MCP configs, plugin commands and terminals run.
// VAULTITE_VAU_ENTRY names another (the app sets it once its code can run from outside its bundle); else this bin/vau.
import path from "node:path"

const ROOT = path.dirname(import.meta.dirname)

/** The `vau` CLI's entry (a script run by Node, or by the app's executable as Node). */
export const vauEntry = (env: Record<string, string | undefined> = process.env) => env.VAULTITE_VAU_ENTRY || path.join(ROOT, "bin", "vau")
