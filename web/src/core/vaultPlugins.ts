import * as React from "react"
import * as ReactDOM from "react-dom"
import * as jsxRuntime from "react/jsx-runtime"
import { Puzzle, type LucideIcon } from "lucide-react"
import * as api from "@/api"
import type { PluginDef, Plugin } from "@/core/define"
import type { State, VaultPluginInfo } from "@/core/data"
import { allowPlugin, setVaultPlugins } from "@/core/plugins"
import { pluginIcon } from "@/core/pages"
import { openDetail } from "@/core/nav"
import { notify } from "@/core/notify"
import { noteAppError } from "@/core/errors"
import { safeToReload } from "@/core/unsaved"
import { API_VERSION } from "../../../core/version.ts"
import { isObj, isText, messageOf } from "../../../core/values.ts"
import exported from "virtual:plugin-exports"

const manifests = import.meta.glob<{ exports?: string[] }>("../../../plugins/core/*/manifest.json", { eager: true, import: "default" })
const versions = new Map<string, string>()

const modules: Record<string, unknown> = { "@vaultite": api, react: React, "react-dom": ReactDOM, "react/jsx-runtime": jsxRuntime }
const editor: Record<string, () => Promise<unknown>> = {
  "@codemirror/state": () => import("@codemirror/state"), "@codemirror/view": () => import("@codemirror/view"),
  "@codemirror/language": () => import("@codemirror/language"), "@codemirror/commands": () => import("@codemirror/commands"),
  "@codemirror/search": () => import("@codemirror/search"), "@codemirror/autocomplete": () => import("@codemirror/autocomplete"),
  "@lezer/common": () => import("@lezer/common"), "@lezer/highlight": () => import("@lezer/highlight"),
}

function moduleLoader(spec: string): (() => Promise<unknown>) | null {
  const m = /^@plugins\/([a-z][a-z0-9-]*)\/([\w-]+(?:\/[\w-]+)*)$/.exec(spec)
  if (!m) return null
  const [, id, name] = m, own = manifests[`../../../plugins/core/${id}/manifest.json`]
  if (own) return exported[`${id}/${name}`] ?? null
  const v = versions.get(id)
  if (!v) return null
  return async () => {
    const mod = await import(/* @vite-ignore */ new URL(`api/plugins/${encodeURIComponent(id)}/${v}/bundle.js`, document.baseURI).href)
    const own: unknown = mod.__exports
    const got = isObj(own) ? own[name] : undefined
    if (!got) throw new Error(`${id} doesn't export ${name}`)
    return got
  }
}

declare global {
  var __vaultite: {
    modules: Record<string, unknown>
    style: (id: string, css: string) => void
    preload: (specs: string[]) => Promise<void>
  }
}

globalThis.__vaultite = {
  modules,
  style(id, css) {
    let el = document.querySelector<HTMLStyleElement>(`style[data-vault-plugin="${CSS.escape(id)}"]`)
    if (!el) {
      el = document.createElement("style")
      el.dataset.vaultPlugin = id
      document.head.append(el)
    }
    if (el.textContent !== css) el.textContent = css
  },
  async preload(specs) {
    for (const spec of specs) {
      if (spec in modules) continue
      const load = editor[spec] ?? moduleLoader(spec)
      if (!load) throw new Error(`no module ${spec} in the app`)
      modules[spec] = await load()
    }
  },
}

const loaded = new Map<string, { version: string; def: PluginDef | null; icon?: LucideIcon; error: string | null; at?: number }>()
const RETRY = 30_000

// A browser keeps a failed import() failed by its URL for the page's life: a retry needs another URL.
const spent = new Set<string>()
let tries = 0

async function importBundle(info: VaultPluginInfo, version: string) {
  const key = `${info.id}/${version}`
  try {
    const url = new URL(`api/plugins/${encodeURIComponent(info.id)}/${version}/bundle.js${spent.has(key) ? `?try=${++tries}` : ""}`, document.baseURI).href
    let late = 0
    const mod = await Promise.race([import(/* @vite-ignore */ url), new Promise<never>((_, no) => { late = window.setTimeout(() => no(new Error("its code didn't arrive in 20 s")), 20_000) })])
      .finally(() => clearTimeout(late))
    const def = (mod.default ?? null) as PluginDef | null
    if (def === null ? !mod.__exports : typeof def !== "object") throw new Error("index.tsx has no default export (export default definePlugin({...}))")
    return { version, def, icon: mod.icon as LucideIcon | undefined, error: null }
  } catch (e) {
    spent.add(key)
    console.warn(`vault plugin ${info.id}:`, e)
    noteAppError("plugin", Object.assign(new Error(`${info.name}: ${messageOf(e)}`), { stack: isObj(e) && isText(e.stack) ? e.stack : undefined }))
    return { version, def: null, error: `index.tsx couldn't run in the app: ${messageOf(e)}`, at: Date.now() }
  }
}

export const tooNew = (info: Pick<VaultPluginInfo, "apiVersion">, api = API_VERSION) => typeof info.apiVersion === "number" && info.apiVersion > api
const RELOADED = "vaultite.reloadedForApi"
function reloadForApi(v: number) {
  try { if (sessionStorage.getItem(RELOADED) === String(v)) return; sessionStorage.setItem(RELOADED, String(v)) } catch { return }
  const go = () => { if (safeToReload()) location.reload(); else setTimeout(go, 5000) }
  go()
}

export async function loadVaultPlugins(state: State) {
  const list = state.vaultPlugins ?? []
  versions.clear()
  for (const info of list) if (info.bundle) versions.set(info.id, info.bundle)
  await Promise.all(list.map(async (info) => {
    if (!info.bundle) return void loaded.delete(info.id)
    if (tooNew(info)) {
      reloadForApi(info.apiVersion!)
      return void loaded.set(info.id, { version: info.bundle, def: null, at: Date.now(),
        error: `written for plugin API ${info.apiVersion}, newer than this window's (${API_VERSION}): it loads once the app reloads` })
    }
    const hit = loaded.get(info.id)
    if (hit?.version === info.bundle && hit.error && Date.now() - (hit.at ?? 0) < RETRY) return
    if (hit?.version !== info.bundle || hit.error) loaded.set(info.id, await importBundle(info, info.bundle))
  }))
  const plugins = list.map((info): Plugin => {
    const hit = info.bundle ? loaded.get(info.id) : undefined
    const { id, name, description, requires, enhances, runsOnServer, desktopApp, ai, tint, category, group, replaces, marks, folder, pages, blocks, draws, settings, warnings } = info
    const { version, author, repo, fundingUrl, disclosures, source, approval, blocked, hash, edits } = info
    return {
      ...hit?.def, icon: hit?.icon ?? pluginIcon(info.icon) ?? Puzzle, id, name, description, requires: requires.length ? requires : undefined,
      enhances: enhances.length ? enhances : undefined, runsOnServer, desktopApp, ai, tint, category, group, replaces, marks, folder, pages, tier: "vault", version: hit?.version,
      problems: [...info.problems, ...(hit?.error ? [hit.error] : [])], warnings: warnings ?? [], blockDecls: blocks ?? {},
      draws: draws?.length ? draws : undefined,
      settingsDecls: settings ?? {},
      meta: { version: version ?? null, author: author ?? null, repo: repo ?? null, fundingUrl: fundingUrl ?? null, disclosures: disclosures ?? {}, source: source ?? null,
        approval: approval ?? null, blocked: blocked ?? null, hash: hash ?? "", edits: !!edits },
    }
  })
  setVaultPlugins(plugins)
  tell(plugins.filter((p) => list.find((i) => i.id === p.id)?.on))
}

const SAID = "vaultite.pluginProblems"
function tell(on: Plugin[]) {
  let said: Record<string, string> = {}
  try { said = JSON.parse(localStorage.getItem(SAID) ?? "{}") } catch { /* private mode */ }
  const next: Record<string, string> = {}
  const moved = on.filter((p) => !p.problems?.length && p.meta?.approval?.state === "moved")
  for (const p of moved) next[p.id] = `approval:${p.meta!.hash}`
  if (moved.some((p) => said[p.id] !== next[p.id])) {
    const names = new Intl.ListFormat("en", { type: "conjunction" }).format(moved.map((p) => p.name))
    notify(`${names} moved out of the app to Vaultite's plugins, with your settings: allow ${moved.length > 1 ? "them" : "it"} on this machine`, {
      id: "plugins:moved", duration: Infinity,
      action: { label: "Allow", run: async () => { for (const p of moved) if (!(await allowPlugin(p))) return; notify(`${names} ${moved.length > 1 ? "are" : "is"} on again`) } } })
  }
  for (const p of on.filter((x) => !moved.includes(x))) {
    const problems = p.problems ?? []
    if (!problems.length && p.meta?.approval) {
      if (p.meta.approval.state === "updating") { next[p.id] = said[p.id] ?? ""; continue }
      next[p.id] = `approval:${p.meta.hash}`
      if (said[p.id] !== next[p.id] && p.meta.approval.state !== "changed") {
        notify(`${p.name} is on in this vault: it waits for you to allow it on this machine`, { id: `plugin:${p.id}`,
          action: { label: "Review", run: () => openDetail(`plugin/${p.id}`) } })
      }
      continue
    }
    if (!problems.length) continue
    next[p.id] = problems.join("\n")
    if (said[p.id] === next[p.id]) continue
    notify(`${p.name} couldn't start`, { kind: "error", id: `plugin:${p.id}`,
      action: { label: "Details", run: () => openDetail(`plugin/${p.id}`) } })
  }
  try { localStorage.setItem(SAID, JSON.stringify(next)) } catch { /* private mode */ }
}
