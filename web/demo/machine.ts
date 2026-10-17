declare const __DEMO_OFFICIAL__: { id: string; machine: boolean }[] | undefined
/** Vaultite's own plugins the demo builds in as the app's (vite.demo.config.ts), and whether each needs a machine. */
export const OFFICIAL = typeof __DEMO_OFFICIAL__ === "undefined" ? [] : __DEMO_OFFICIAL__

// Plugins that need a machine (a shell, agents, other apps, the network as a server): off in the demo and refused if
// turned on, their backends left out of its bundle (vite.demo.config.ts).
export const MACHINE = ["terminal", "claude-code", "codex", "mcp", "machines",
  "activity", "agent-meters", "ai-import", "audio-recorder", "clipper", "calendar",
  ...OFFICIAL.filter((o) => o.machine).map((o) => o.id)]

/** Of those, the ones the demo still draws, with the made-up data of their own preview (a plugin's `mockLive`, answered in
 *  the page: boot.ts): what agents did, their sessions and limits, other machines. Their backends are still left out, so
 *  nothing runs; a bundle turns them on or off as it says. By id: Vaultite's own plugins too (OFFICIAL). */
export const SHOWN = ["claude-code", "codex", "cursor", "opencode", "openclaw", "hermes", "machines", "activity"]
/** What needs a machine and isn't drawn with made-up data: off in the demo. */
export const OFF = MACHINE.filter((id) => !SHOWN.includes(id))

export type PluginsJson = { disabled?: string[]; enabled?: string[]; install?: Record<string, { name?: string; source?: string }> }
export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

/** What needs a machine stays off (but what's SHOWN): in the sandbox's setup, and in every bundle the visitor applies. */
export function machineOff(cfg: PluginsJson) {
  cfg.disabled = [...new Set([...(cfg.disabled ?? []), ...OFF])]
  cfg.enabled = (cfg.enabled ?? []).filter((id) => !OFF.includes(id))
  return cfg
}

/** Its sidebars without the panels of what needs a machine (an empty Terminals panel looks broken). */
export function panelsOff(cfg: Record<string, unknown>) {
  for (const side of ["left", "right", "collapsed"]) {
    if (Array.isArray(cfg[side])) cfg[side] = (cfg[side] as unknown[]).filter((k) => typeof k !== "string" || !OFF.includes(k.split(":")[0]))
  }
  return cfg
}

/** One of Vaultite's own plugins, which the demo has built in: a bundle installing it from there gets this one. */
const builtIn = (id: string, source: unknown) => typeof source === "string" && source === `Vaultite/plugins/${id}` && OFFICIAL.some((o) => o.id === id)

/** A bundle's files (an export's) as the demo applies them: what needs a machine off, and the vault plugins it brings or
 *  installs left out, by name (they run code: the app asks first), but Vaultite's own, built in here. `plugins`: its
 *  plugins.json as it came. */
export function fitForDemo(given: Record<string, unknown>) {
  const files = { ...given }
  const read = (rel: string) => { const v = files[rel]; try { return isObj(v) ? v : typeof v === "string" ? JSON.parse(v) : null } catch { return null } }
  const pj = read("plugins.json") as PluginsJson | null
  const code = new Map<string, string>()
  for (const rel of Object.keys(files)) {
    const m = /^plugins\/([^/]+)\/manifest\.json$/.exec(rel)
    if (m) code.set(m[1], String(read(rel)?.name ?? m[1]))
  }
  for (const [id, x] of Object.entries(isObj(pj?.install) ? pj.install : {})) if (!builtIn(id, x?.source)) code.set(id, String(x?.name ?? id))
  for (const rel of Object.keys(files)) if (rel.startsWith("plugins/") && code.has(rel.split("/")[1])) delete files[rel]
  const sb = read("sidebars.json")
  if (sb) files["sidebars.json"] = JSON.stringify(panelsOff(sb), null, 2) + "\n"
  if (pj) {
    const out = machineOff(structuredClone(pj))
    // (Vaultite's own it installs are built in here: the core leaves their installs to the app's own)
    const kept = Object.entries(isObj(out.install) ? out.install : {}).filter(([id, x]) => builtIn(id, x?.source))
    if (kept.length) out.install = Object.fromEntries(kept); else delete out.install
    out.enabled = out.enabled!.filter((id) => !code.has(id))
    files["plugins.json"] = JSON.stringify(out, null, 2) + "\n"
  }
  return { files, plugins: pj ?? {}, code: [...code.values()] }
}
