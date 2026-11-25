import { onMachine, op, openAgent, openView } from "@vaultite"
import { type Harness, shellLine } from "./harness"

export async function handOff(h: Harness, session: string, o: { machine?: string | null; cwd?: string; server?: string } = {}) {
  if (h.agent && !o.server) return openAgent(h.agent, { resume: session, machine: o.machine, newTab: true })
  const r = await op<{ id: string }>("terminal.start", { command: shellLine(h.resume(session, o.server)), name: `${h.name} ${session.slice(0, 8)}`,
    cwd: o.cwd || undefined, machine: o.machine || undefined })
  openView(`terminal/${onMachine(r.id, o.machine)}`, { newTab: true })
}
