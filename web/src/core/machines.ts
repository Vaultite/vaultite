// The other machines this vault's app runs on (Machines plugin): terminals `terminal/<id>@<machine>`, live data through
// /api/machines/<machine>/<path> (machinePath). Nothing when the plugin is off.
import { useLive } from "@/core/data"
import { get } from "@/core/http"
import { isEnabled, useEnabled } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"

/** A machine as GET /api/machines says: `self` is the one serving this app; `plugins`, the ones that are on there;
 *  `vault`, its vault's id (the same as this one's: it has this vault). */
export type Machine = {
  id: string; label: string; url: string; online: boolean; self: boolean
  dial?: boolean; readOnly?: boolean; via?: string; home?: string
  host?: string; platform?: string; version?: string; commit?: string; plugins?: string[]; vault?: string; error?: string
}

/** The machines, live (null until they're known; [] with the plugin off). */
export function useMachines(): Machine[] | null {
  const on = useEnabled()("machines")
  const { data } = useLive<Machine[]>(on ? "machines" : null)
  return on ? data : []
}

/** The machines, once ([] with the plugin off or when the server doesn't answer). */
export async function fetchMachines(): Promise<Machine[]> {
  if (!isEnabled("machines", getPrefs().disabled)) return []
  try { return await get<Machine[]>("machines") } catch { return [] }
}

/** The other machines that are online and have `plugin` on (all online ones without it). */
export const otherMachines = (list: Machine[] | null, plugin?: string) =>
  (list ?? []).filter((m) => !m.self && m.online && (!plugin || m.plugins?.includes(plugin)))

/** An API path on a machine ("" or none: this one): "claude-code?days=7" -> "machines/studio/claude-code?days=7". */
export const machinePath = (machine: string | null | undefined, path: string) => (machine ? `machines/${machine}/${path}` : path)

/** "claude-k3j2@studio" -> ["claude-k3j2", "studio"]; an id of this machine's -> [id, ""]. */
export function splitMachine(id: string): [string, string] {
  const at = id.indexOf("@")
  return at < 0 ? [id, ""] : [id.slice(0, at), id.slice(at + 1)]
}

/** `id` on `machine` ("" or none: as it is). */
export const onMachine = (id: string, machine?: string | null) => (machine ? `${id}@${machine}` : id)
