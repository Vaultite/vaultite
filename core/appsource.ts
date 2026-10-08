// What the server knows of the app only from its source (commands, sidebar panels, new tab sections, icons, schemes),
// for the ops that list them; keep those greppable. The packaged app has no source: it reads electron/cli.json instead.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** A plugin's folder, as these readers need it. */
export type PluginDir = { id: string; tier: string; dir: string }

/** A palette command with a fixed id: its default keys (none: []); `note`: "desktop app only". */
export type CommandDef = { id: string; name: string; keys: string[]; note?: string }

/** A sidebar panel: `<plugin>:<name>`, its title (its `heading` when it has another: "Pinned"), its default place
 *  (`sort`), whether it's out of the default setup (`hidden`), other names it goes by (`names`), and whether a phone can
 *  dock it (`dockable`). */
export type PanelDef = { key: string; title: string; heading?: string; sort: number; plugin: string; hidden: boolean; names: string[]; dockable?: true }

/** A plugin's section of a new tab's page: `<plugin>:<name>`, its title, default place, whether it's out of the default
 *  page (`hidden`) and where it's drawn (`only`: phones or computers). */
export type SectionDef = { key: string; title: string; sort: number; plugin: string; hidden: boolean; only?: "phone" | "desktop" }

type Snapshot = { commands: CommandDef[]; panels: Record<string, PanelDef[]>; sections?: Record<string, SectionDef[]>; icons?: string[] }

const SNAPSHOT = path.join(ROOT, "electron", "cli.json")
let snap: Snapshot | null | undefined
function snapshot(): Snapshot | null {
  if (snap === undefined) try { snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as Snapshot } catch { snap = null }
  return snap ?? null
}

/** The app's source is here (a checkout), not only its build. */
export const hasSource = () => fs.existsSync(path.join(ROOT, "web", "src", "App.tsx"))

const subdirs = (d: string) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name)).sort() } catch { return [] }
}

/** The app's built-in plugin folders (plugins/core/). */
export const appPluginDirs = (): PluginDir[] =>
  subdirs(path.join(ROOT, "plugins", "core")).filter((d) => fs.existsSync(path.join(d, "manifest.json"))).map((dir) => ({ id: path.basename(dir), tier: "core", dir }))

/** The snapshot of this checkout's source (electron/stamp.ts writes it into electron/cli.json). */
export function sourceSnapshot(): Snapshot {
  const plugins = appPluginDirs()
  return {
    commands: scanCommands([...walkSrc(path.join(ROOT, "web", "src")), ...plugins.map((p) => path.join(p.dir, "index.tsx"))]),
    panels: Object.fromEntries(plugins.map((p) => [p.id, panelsOf(p)]).filter(([, ps]) => ps.length)),
    sections: Object.fromEntries(plugins.map((p) => [p.id, sectionsOf(p)]).filter(([, ps]) => ps.length)),
    icons: appIcons(plugins),
  }
}

// ---------- reading object literals out of source ----------

/** The text of the `{...}` that opens at `at` (strings skipped). */
function braced(src: string, at: number) {
  let depth = 0
  for (let i = at; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++
    } else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) return src.slice(at, i + 1)
  }
  return src.slice(at)
}

/** The top-level `key: {...}` entries of an object literal's text. */
function entries(obj: string): [string, string][] {
  const out: [string, string][] = []
  const re = /["']?([\w-]+)["']?\s*:\s*\{/g
  let depth = 0
  for (let i = 1; i < obj.length - 1; i++) {
    const ch = obj[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      if (depth === 0) {
        re.lastIndex = i
        const m = re.exec(obj)
        if (m && m.index === i) {
          const body = braced(obj, re.lastIndex - 1)
          out.push([m[1], body])
          i = re.lastIndex - 1 + body.length - 1
          continue
        }
      }
      for (i++; i < obj.length && obj[i] !== ch; i++) if (obj[i] === "\\") i++
    } else if (depth === 0 && /[\w]/.test(ch) && !/[\w$]/.test(obj[i - 1])) {
      re.lastIndex = i
      const m = re.exec(obj)
      if (m && m.index === i) {
        const body = braced(obj, re.lastIndex - 1)
        out.push([m[1], body])
        i = re.lastIndex - 1 + body.length - 1
      }
    } else if (ch === "{" || ch === "(" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === "]") depth--
  }
  return out
}

/** The keys of the object literal `<name> = {` or `<name>: {` opens in a file's source. */
function keysOf(file: string, at: RegExp) {
  let src = ""
  try { src = fs.readFileSync(file, "utf8") } catch { return [] }
  const m = at.exec(src)
  return m ? [...braced(src, m.index + m[0].length - 1).matchAll(/"?([a-z][\w-]*)"?\s*:/g)].map((x) => x[1]) : []
}

function walkSrc(d: string): string[] {
  let names: fs.Dirent[]
  try { names = fs.readdirSync(d, { withFileTypes: true }) } catch { return [] }
  return names.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => (e.isDirectory() ? walkSrc(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []))
}

// ---------- panels ----------

/** A plugin's sidebar panels, read from its index.tsx (`sidebar: { <name>: { title, sort, hidden, heading, names, dockable } }`);
 *  an app plugin's from the build's snapshot when its source isn't here. */
export function panelsOf(p: PluginDir): PanelDef[] {
  const found = declared(p, "sidebar")
  if (!found) return p.tier !== "vault" && !hasSource() ? snapshot()?.panels[p.id] ?? [] : []
  return found.map(([name, body]) => {
    const heading = /\bheading\s*:\s*["'`]([^"'`]+)["'`]/.exec(body)?.[1]
    const names = /\bnames\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? ""
    return {
      key: `${p.id}:${name}`, plugin: p.id,
      title: /\btitle\s*:\s*["'`]([^"'`]+)["'`]/.exec(body)?.[1] ?? name,
      ...(heading ? { heading } : {}),
      sort: Number(/\bsort\s*:\s*(-?\d+)/.exec(body)?.[1] ?? 100),
      hidden: /\bhidden\s*:\s*true\b/.test(body),
      names: [...names.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]),
      ...(/\bdockable\s*:\s*true\b/.test(body) ? { dockable: true as const } : {}),
    }
  })
}

/** A plugin's new tab sections from its index.tsx (`newTab: { <name>: {...} }`),
 *  or from the build's snapshot when its source isn't here. */
export function sectionsOf(p: PluginDir): SectionDef[] {
  const found = declared(p, "newTab")
  if (!found) return p.tier !== "vault" && !hasSource() ? snapshot()?.sections?.[p.id] ?? [] : []
  return found.map(([name, body]) => {
    const only = /\bonly\s*:\s*["'`](phone|desktop)["'`]/.exec(body)?.[1] as SectionDef["only"]
    return {
      key: `${p.id}:${name}`, plugin: p.id,
      title: /\btitle\s*:\s*["'`]([^"'`]+)["'`]/.exec(body)?.[1] ?? name,
      sort: Number(/\bsort\s*:\s*(-?\d+)/.exec(body)?.[1] ?? 100),
      hidden: /\bhidden\s*:\s*true\b/.test(body),
      ...(only ? { only } : {}),
    }
  })
}

const readSource = (p: PluginDir) => { try { return fs.readFileSync(path.join(p.dir, "index.tsx"), "utf8") } catch { return null } }

/** The `<field>: { <name>: {...} }` entries of a plugin's definition (index.tsx): [name, body]; null when there's no
 *  source to read (an app plugin's in the packaged app: its snapshot), [] when it has none. */
function declared(p: PluginDir, field: string): [string, string][] | null {
  const src = readSource(p)
  if (src === null) return null
  const m = new RegExp(`\\b${field}\\s*:\\s*\\{`).exec(src)
  return m ? entries(braced(src, m.index + m[0].length - 1)) : []
}

// ---------- commands ----------

/** The palette's commands with fixed ids, from the app's and plugins' source (made-up ids, like a view per file, aren't
 *  here); the packaged app's from its build's snapshot. */
export function commandList(vaultPlugins: PluginDir[]): CommandDef[] {
  if (hasSource()) return scanCommands([...walkSrc(path.join(ROOT, "web", "src")), ...[...appPluginDirs(), ...vaultPlugins].map((p) => path.join(p.dir, "index.tsx"))])
  const own = scanCommands(vaultPlugins.map((p) => path.join(p.dir, "index.tsx")))
  const app = snapshot()?.commands ?? []
  return [...app, ...own.filter((x) => !app.some((y) => y.id === x.id))].sort((a, b) => a.id.localeCompare(b.id))
}

function scanCommands(files: string[]): CommandDef[] {
  const out = new Map<string, CommandDef>()
  const re = /\{\s*id:\s*"([\w-]+:[\w-]+)",\s*name:\s*"([^"]+)"(?:,\s*keys:\s*([^\n]*?)(?:,\s*(?:when|run):|\s*\}))?/g
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    for (const m of src.matchAll(re)) {
      if (out.has(m[1])) continue
      const keys = [...(m[3] ?? "").matchAll(/"((?:[^"\\]|\\.)+)"/g)].map((k) => k[1].replace(/\\(.)/g, "$1"))
      out.set(m[1], { id: m[1], name: m[2], keys, note: /desktopApp/.test(m[3] ?? "") ? "desktop app only" : undefined })
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// ---------- icons and schemes ----------

function appIcons(plugins: PluginDir[]) {
  const own = keysOf(path.join(ROOT, "web", "src", "core", "pages.ts"), /\bICONS\b[^=]*=\s*\{/)
  return [...own, ...plugins.flatMap((p) => keysOf(path.join(p.dir, "index.tsx"), /\bicons\s*:\s*\{/))]
}

/** The icons a page's `icon:` can name (ICONS in web/src/core/pages.ts and plugins' `icons`). Empty when unknown (an old
 *  packaged app): then any name may be one. */
export function pageIcons(vaultPlugins: PluginDir[]): string[] {
  const app = hasSource() ? appIcons(appPluginDirs()) : snapshot()?.icons ?? []
  if (!app.length) return []
  return [...new Set([...app, ...vaultPlugins.flatMap((p) => keysOf(path.join(p.dir, "index.tsx"), /\bicons\s*:\s*\{/))])]
}

/** The app's colour schemes: "default" (Classic) and one per web/src/themes/<name>.css (shipped with the packaged app). */
export function schemes(): string[] {
  let names: string[] = []
  try { names = fs.readdirSync(path.join(ROOT, "web", "src", "themes")) } catch { /* none */ }
  return ["default", ...names.filter((n) => n.endsWith(".css")).map((n) => n.slice(0, -4))]
}
