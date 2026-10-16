// Plugins that need a machine (a shell, agents, other apps, the network as a server): off in the demo and refused if
// turned on, their backends left out of its bundle (vite.demo.config.ts).
export const MACHINE = ["terminal", "claude-code", "codex", "cursor", "opencode", "openclaw", "hermes", "dispatch", "mcp", "machines",
  "activity", "agent-meters", "ai-import", "audio-recorder", "app-windows", "dock-icon", "clipper", "calendar"]

export type PluginsJson = { disabled?: string[]; enabled?: string[]; install?: Record<string, { name?: string }> }
export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

/** What needs a machine stays off: in the sandbox's setup, and in every bundle the visitor applies. */
export function machineOff(cfg: PluginsJson) {
  cfg.disabled = [...new Set([...(cfg.disabled ?? []), ...MACHINE])]
  cfg.enabled = (cfg.enabled ?? []).filter((id) => !MACHINE.includes(id))
  return cfg
}

/** Its sidebars without the panels of what needs a machine (an empty Terminals panel looks broken). */
export function panelsOff(cfg: Record<string, unknown>) {
  for (const side of ["left", "right", "collapsed"]) {
    if (Array.isArray(cfg[side])) cfg[side] = (cfg[side] as unknown[]).filter((k) => typeof k !== "string" || !MACHINE.includes(k.split(":")[0]))
  }
  return cfg
}

/** A bundle's files (an export's) as the demo applies them: what needs a machine off, and the vault plugins it brings or
 *  installs left out, by name (they run code: the app asks first). `plugins`: its plugins.json as it came. */
export function fitForDemo(given: Record<string, unknown>) {
  const files = { ...given }
  const read = (rel: string) => { const v = files[rel]; try { return isObj(v) ? v : typeof v === "string" ? JSON.parse(v) : null } catch { return null } }
  const pj = read("plugins.json") as PluginsJson | null
  const code = new Map<string, string>()
  for (const rel of Object.keys(files)) {
    const m = /^plugins\/([^/]+)\/manifest\.json$/.exec(rel)
    if (m) code.set(m[1], String(read(rel)?.name ?? m[1]))
  }
  for (const [id, x] of Object.entries(isObj(pj?.install) ? pj.install : {})) code.set(id, String(x?.name ?? id))
  for (const rel of Object.keys(files)) if (rel.startsWith("plugins/") && code.has(rel.split("/")[1])) delete files[rel]
  const sb = read("sidebars.json")
  if (sb) files["sidebars.json"] = JSON.stringify(panelsOff(sb), null, 2) + "\n"
  if (pj) {
    const out = machineOff(structuredClone(pj))
    delete out.install
    out.enabled = out.enabled!.filter((id) => !code.has(id))
    files["plugins.json"] = JSON.stringify(out, null, 2) + "\n"
  }
  return { files, plugins: pj ?? {}, code: [...code.values()] }
}
