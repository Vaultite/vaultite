// Another machine's browser (Machines), asked through its server: the same route there. The live view's and logins'.
import { HTTPError, MACHINE_CLIENT, type Machine, type Plugin } from "../../../core/plugins.ts"

/** The machine `id` names, answering (null: this server's own, by its id or none). */
export async function machineOf(plugin: Plugin, id: string): Promise<Machine | null> {
  if (!id || id === await plugin.ask<string | null>("machines:self", null)) return null
  const m = await plugin.ask<Machine | null>("machines:machine", null, id)
  if (!m) throw new HTTPError(404, `no machine '${id}' (Machines)`)
  if (!m.online) throw new HTTPError(502, `${m.label} doesn't answer`)
  return m
}

/** The same route on machine `m`, its error passed on. */
export async function askThere<T>(m: Machine, method: string, route: string, body?: unknown, ms = 10_000): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${m.url}/api/${route}`, { method, headers: { ...MACHINE_CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) })
  } catch { throw new HTTPError(502, `${m.label} doesn't answer`) }
  const answer = await r.json().catch(() => ({})) as { error?: string }
  if (!r.ok) throw new HTTPError(r.status, String(answer.error || `${m.label} answered ${r.status}`))
  return answer as T
}

/** The other machines with this plugin and a desktop app's browser, answering now. */
export async function otherBrowsers(plugin: Plugin): Promise<{ self: Machine | null; others: Machine[] }> {
  const ms = await plugin.ask<Machine[]>("machines", [])
  return { self: ms.find((m) => m.self) ?? null, others: ms.filter((m) => !m.self && m.online && m.desktop && m.plugins?.includes(plugin.id)) }
}
