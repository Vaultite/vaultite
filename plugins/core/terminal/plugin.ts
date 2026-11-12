import { plugin } from "./shared.ts"
import "./backends.ts"
import { startedOn } from "./terms.ts"
import "./start.ts"
import "./machines.ts"
import { listNow } from "./list.ts"
import "./routes.ts"
import { runOps } from "./run.ts"
import { terminalOps } from "./ops.ts"

export { plugin, TERMINAL_ID } from "./shared.ts"
export { agentOf } from "./backends.ts"
export { askOn, markMissing, menuAt, missingText, stateCommand, type StateChange } from "./terms.ts"

terminalOps(plugin)
runOps(plugin, { startedOn, listNow })
