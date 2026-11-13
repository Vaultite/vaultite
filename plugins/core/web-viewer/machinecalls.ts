import { z } from "zod"
import { HTTPError, MACHINE_CLIENT, type Machine, type Plugin } from "../../../core/plugins.ts"

const FAILED = z.object({ error: z.string().optional().catch(undefined) }).catch({})

export const desktopOf = (plugin: Plugin) => async <T>(name: string, ...args: unknown[]) => {
  try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new HTTPError(409, e instanceof Error ? e.message : String(e)) }
}

export async function machineOf(plugin: Plugin, id: string): Promise<Machine | null> {
  if (!id || id === await plugin.ask<string | null>("machines:self", null)) return null
  const m = await plugin.ask<Machine | null>("machines:machine", null, id)
  if (!m) throw new HTTPError(404, `no machine '${id}' (Machines)`)
  if (!m.online) throw new HTTPError(502, `${m.label} doesn't answer`)
  return m
}

/** Any JSON answer, passed on as it is. */
export const JSON_ANSWER = z.json()

export async function askThere<S extends z.ZodType>(m: Machine, method: string, route: string, answers: S, body?: z.core.util.JSONType, ms = 10_000): Promise<z.output<S>> {
  let r: Response
  try {
    r = await fetch(`${m.url}/api/${route}`, { method, headers: { ...MACHINE_CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) })
  } catch { throw new HTTPError(502, `${m.label} doesn't answer`) }
  const answer: unknown = await r.json().catch(() => ({}))
  if (!r.ok) throw new HTTPError(r.status, FAILED.parse(answer).error || `${m.label} answered ${r.status}`)
  return answers.parse(answer)
}

export async function otherBrowsers(plugin: Plugin): Promise<{ self: Machine | null; others: Machine[] }> {
  const ms = await plugin.ask<Machine[]>("machines", [])
  return { self: ms.find((m) => m.self) ?? null, others: ms.filter((m) => !m.self && m.online && m.desktop && m.plugins?.includes(plugin.id)) }
}
