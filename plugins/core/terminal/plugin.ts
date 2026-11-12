// Terminal: login shells on this machine in a backend that outlives the server (the terminal server or another plugin's), a
// WebSocket per tab at /api/terminal/<id>. A shell is everything, so only this machine's owner gets one (plugin.refusal).

// Its parts register themselves as they load: at load they read only shared.ts, so the order they load in is free.
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

terminalOps(plugin) // vau terminal ...: terminal.list, open, resume, screen, send, end, tidy (ops.ts), through these routes
runOps(plugin, { startedOn, listNow }) // vau terminal run: a file handed to an agent or a command, here or on another machine (run.ts)
