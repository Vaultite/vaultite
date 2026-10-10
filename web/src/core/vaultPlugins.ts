// Vault plugins in the app: their server-built bundles take React and the plugin API from globalThis.__vaultite, so
// they share the app's instances; a new version is imported before the state is drawn, so edits show without a restart.
import * as React from "react"
import * as ReactDOM from "react-dom"
import * as jsxRuntime from "react/jsx-runtime"
import { Puzzle, type LucideIcon } from "lucide-react"
import * as api from "@/api"
import type { PluginDef, Plugin } from "@/core/define"
import type { State, VaultPluginInfo } from "@/core/data"
import { setVaultPlugins } from "@/core/plugins"
import { pluginIcon } from "@/core/pages"
import { openDetail } from "@/core/nav"
import { notify } from "@/core/notify"

// The app's plugins' modules, for vault plugins that require them (@plugins/core/logs/sections): loaded when asked.
const repo = import.meta.glob(["../../../plugins/*/*/**/*.{ts,tsx}", "!../../../plugins/**/plugin.ts", "!../../../plugins/**/import.ts", "!../../../plugins/**/cli.ts"])

const modules: Record<string, unknown> = { "@vaultite": api, react: React, "react-dom": ReactDOM, "react/jsx-runtime": jsxRuntime }
// The app's CodeMirror (core/rules.ts SHARED_EDITOR), for plugins whose `editor` extensions need the editor's own copy.
const editor: Record<string, () => Promise<unknown>> = {
  "@codemirror/state": () => import("@codemirror/state"), "@codemirror/view": () => import("@codemirror/view"),
  "@codemirror/language": () => import("@codemirror/language"), "@codemirror/commands": () => import("@codemirror/commands"),
  "@codemirror/search": () => import("@codemirror/search"), "@codemirror/autocomplete": () => import("@codemirror/autocomplete"),
  "@lezer/common": () => import("@lezer/common"), "@lezer/highlight": () => import("@lezer/highlight"),
}

/** "@plugins/core/logs/sections" -> its loader's key ("../../../plugins/core/logs/sections.tsx"). */
function repoKey(spec: string) {
  const base = `../../../plugins/${spec.slice("@plugins/".length).replace(/\.tsx?$/, "")}`
  return [".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => base + x).find((k) => k in repo) ?? null
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
  /** A plugin's styles (its Tailwind classes), in the `plugins` layer (under the app's utilities: web/index.html). */
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
      const key = repoKey(spec), load = editor[spec] ?? (key && repo[key])
      if (!load) throw new Error(`no module ${spec} in the app`)
      modules[spec] = await load()
    }
  },
}

const loaded = new Map<string, { version: string; def: PluginDef | null; icon?: LucideIcon; error: string | null; at?: number }>()
/** A bundle that failed is tried again at most this often (a state comes every second while agents write). */
const RETRY = 30_000

let tries = 0 // a failed import is remembered by its URL: another try needs another one

async function importBundle(info: VaultPluginInfo, version: string, retry: boolean) {
  try {
    const url = new URL(`api/plugins/${encodeURIComponent(info.id)}/${version}/bundle.js${retry ? `?try=${++tries}` : ""}`, document.baseURI).href
    // (an import that never settles would hold the state's arrival with it: the app's state waits for its plugins)
    let late = 0
    const mod = await Promise.race([import(/* @vite-ignore */ url), new Promise<never>((_, no) => { late = window.setTimeout(() => no(new Error("its code didn't arrive in 20 s")), 20_000) })])
      .finally(() => clearTimeout(late))
    const def = mod.default as PluginDef | undefined
    if (!def || typeof def !== "object") throw new Error("index.tsx has no default export (export default definePlugin({...}))")
    // (its icon by a Lucide name comes with it: core/vaultplugins.ts bundle)
    return { version, def, icon: mod.icon as LucideIcon | undefined, error: null }
  } catch (e) {
    // (it may have changed again meanwhile: a newer state brings it, or tries this one again)
    console.warn(`vault plugin ${info.id}:`, e)
    return { version, def: null, error: `index.tsx couldn't run in the app: ${(e as Error).message ?? e}`, at: Date.now() }
  }
}

/** The vault plugins in this state: bundles that are new since last time are imported, then the list is replaced. */
export async function loadVaultPlugins(state: State) {
  const list = state.vaultPlugins ?? []
  await Promise.all(list.map(async (info) => {
    if (!info.bundle) return void loaded.delete(info.id)
    const hit = loaded.get(info.id)
    if (hit?.version === info.bundle && !hit.def && Date.now() - (hit.at ?? 0) < RETRY) return
    if (hit?.version !== info.bundle || !hit.def) loaded.set(info.id, await importBundle(info, info.bundle, hit?.version === info.bundle))
  }))
  const plugins = list.map((info): Plugin => {
    const hit = info.bundle ? loaded.get(info.id) : undefined
    const { id, name, description, requires, enhances, runsOnServer, tint, category, replaces, folder, pages, blocks, settings, warnings } = info
    const { version, author, repo, fundingUrl, disclosures, source, approval, blocked, hash, edits } = info
    return {
      ...hit?.def, icon: hit?.icon ?? pluginIcon(info.icon) ?? Puzzle, id, name, description, requires: requires.length ? requires : undefined,
      enhances: enhances.length ? enhances : undefined, runsOnServer, tint, category, replaces, folder, pages, tier: "vault", version: hit?.version,
      problems: [...info.problems, ...(hit?.error ? [hit.error] : [])], warnings: warnings ?? [], blockDecls: blocks ?? {},
      settingsDecls: settings ?? {},
      meta: { version: version ?? null, author: author ?? null, repo: repo ?? null, fundingUrl: fundingUrl ?? null, disclosures: disclosures ?? {}, source: source ?? null,
        approval: approval ?? null, blocked: blocked ?? null, hash: hash ?? "", edits: !!edits },
    }
  })
  setVaultPlugins(plugins)
  tell(plugins.filter((p) => list.find((i) => i.id === p.id)?.on))
}

// A plugin that's on but failed to build or load, or waits to be allowed here, says so once per change (the same problems again, after a reload of
// the page too, stay quiet; this device remembers what it last said). Details: its sheet on the Plugins page.
const SAID = "vaultite.pluginProblems"
function tell(on: Plugin[]) {
  let said: Record<string, string> = {}
  try { said = JSON.parse(localStorage.getItem(SAID) ?? "{}") } catch { /* private mode */ }
  const next: Record<string, string> = {}
  for (const p of on) {
    const problems = p.problems ?? []
    // On, but waiting for this machine's yes (it came by sync, or changed): said once per version.
    if (!problems.length && p.meta?.approval) {
      // (updated on its own elsewhere and being checked against its source: allowed in a moment, the server says so)
      if (p.meta.approval.state === "updating") { next[p.id] = said[p.id] ?? ""; continue }
      next[p.id] = `approval:${p.meta.hash}`
      if (said[p.id] !== next[p.id]) {
        notify(`${p.name} ${p.meta.approval.state === "new" ? "is on in this vault" : "changed"}: it waits for you to allow it on this machine`, { id: `plugin:${p.id}`,
          action: { label: "Review", run: () => openDetail(`plugin/${p.id}`) } })
      }
      continue
    }
    if (!problems.length) continue
    next[p.id] = problems.join("\n")
    if (said[p.id] === next[p.id]) continue
    const first = problems[0].split("\n")[0]
    notify(`${p.name} couldn't load: ${first.length > 140 ? `${first.slice(0, 140)}…` : first}`, { kind: "error", id: `plugin:${p.id}`,
      action: { label: "Details", run: () => openDetail(`plugin/${p.id}`) } })
  }
  try { localStorage.setItem(SAID, JSON.stringify(next)) } catch { /* private mode */ }
}
