import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { readJson } from "./jsonfile.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export type PluginDir = { id: string; tier: string; dir: string }

const CommandDef = z.object({ id: z.string(), name: z.string(), keys: z.array(z.string()), note: z.string().optional() })
export type CommandDef = z.infer<typeof CommandDef>

/** `sort`: its default place; `hidden`: out of the default setup; `dockable`: by a phone. */
const PanelDef = z.object({ key: z.string(), title: z.string(), heading: z.string().optional(), sort: z.number(), plugin: z.string(), hidden: z.boolean(),
  side: z.literal("right").optional(), names: z.array(z.string()), dockable: z.literal(true).optional() })
export type PanelDef = z.infer<typeof PanelDef>

const SectionDef = z.object({ key: z.string(), title: z.string(), sort: z.number(), plugin: z.string(), hidden: z.boolean(), only: z.enum(["phone", "desktop"]).optional() })
export type SectionDef = z.infer<typeof SectionDef>

const Snapshot = z.object({ commands: z.array(CommandDef), panels: z.record(z.string(), z.array(PanelDef)), sections: z.record(z.string(), z.array(SectionDef)).optional(),
  icons: z.array(z.string()).optional() })
type Snapshot = z.infer<typeof Snapshot>

const SNAPSHOT = path.join(ROOT, "electron", "cli.json")
let snap: Snapshot | null | undefined
function snapshot(): Snapshot | null {
  if (snap === undefined) { const r = readJson(SNAPSHOT, Snapshot); snap = r.ok ? r.value : null }
  return snap ?? null
}

const hasSource = () => fs.existsSync(path.join(ROOT, "web", "src", "App.tsx"))

const subdirs = (d: string) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name)).sort() } catch { return [] }
}

const appPluginDirs = (): PluginDir[] =>
  subdirs(path.join(ROOT, "plugins", "core")).filter((d) => fs.existsSync(path.join(d, "manifest.json"))).map((dir) => ({ id: path.basename(dir), tier: "core", dir }))

export function sourceSnapshot(): Snapshot {
  const plugins = appPluginDirs()
  return {
    commands: scanCommands([...walkSrc(path.join(ROOT, "web", "src")), ...plugins.map((p) => path.join(p.dir, "index.tsx"))]),
    panels: Object.fromEntries(plugins.map((p) => [p.id, panelsOf(p)]).filter(([, ps]) => ps.length)),
    sections: Object.fromEntries(plugins.map((p) => [p.id, sectionsOf(p)]).filter(([, ps]) => ps.length)),
    icons: appIcons(plugins),
  }
}

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
      ...(/\bside\s*:\s*["'`]right["'`]/.test(body) ? { side: "right" as const } : {}),
      names: [...names.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]),
      ...(/\bdockable\s*:\s*true\b/.test(body) ? { dockable: true as const } : {}),
    }
  })
}

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

/** null: no source to read (an app plugin in the packaged app); []: none declared. */
function declared(p: PluginDir, field: string): [string, string][] | null {
  const src = readSource(p)
  if (src === null) return null
  const m = new RegExp(`\\b${field}\\s*:\\s*\\{`).exec(src)
  return m ? entries(braced(src, m.index + m[0].length - 1)) : []
}

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

function appIcons(plugins: PluginDir[]) {
  const own = keysOf(path.join(ROOT, "web", "src", "core", "pages.ts"), /\bICONS\b[^=]*=\s*\{/)
  return [...own, ...plugins.flatMap((p) => keysOf(path.join(p.dir, "index.tsx"), /\bicons\s*:\s*\{/))]
}

/** Empty when unknown (an old packaged app): then any name may be one. */
export function pageIcons(vaultPlugins: PluginDir[]): string[] {
  const app = hasSource() ? appIcons(appPluginDirs()) : snapshot()?.icons ?? []
  if (!app.length) return []
  return [...new Set([...app, ...vaultPlugins.flatMap((p) => keysOf(path.join(p.dir, "index.tsx"), /\bicons\s*:\s*\{/))])]
}

export function schemes(): string[] {
  let names: string[] = []
  try { names = fs.readdirSync(path.join(ROOT, "web", "src", "themes")) } catch { /* none */ }
  return ["default", ...names.filter((n) => n.endsWith(".css")).map((n) => n.slice(0, -4))]
}
