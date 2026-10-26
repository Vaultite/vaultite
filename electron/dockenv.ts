// Imported first (main.ts): the app opened by an agent (`open -a`, an update it ran) or from one of its terminals runs as
// if opened from the Dock, else its terminals and accounts would be that session's (Work's sessions in its account).
import { asFromDock } from "../core/sessionenv.ts"

// (a copy a script runs with folders of its own may choose the account on purpose: web/qa, tools/perf)
const scripted = !!(process.env.VAULTITE_USER_DATA || process.env.VAULTITE_QUIET || process.env.VAULTITE_SETUP_HOME)
const dropped = asFromDock(process.env, scripted)
if (dropped.length) console.log(`opened from an agent's session or a terminal: left out ${dropped.join(", ")}`)
