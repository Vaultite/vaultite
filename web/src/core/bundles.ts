import { useEffect } from "react"
import { getStore, reload } from "@/core/data"
import { del, get, op, post, request } from "@/core/http"
import { openTab } from "@/core/workspace"
import { openDetail, replaceDetail, route } from "@/core/nav"
import { openFile } from "@/core/files"
import { dismissNotice, notify, notifyError } from "@/core/notify"
import { currentWorkspace, landingWorkspace } from "@/core/scope"
import type { Info as BundleInfo, Plan, PlanChange, ShareItem } from "../../../core/bundles.ts"
import type { Sketch } from "../../../core/bundlesketch.ts"
import { parseRepo, repoText } from "../../../core/bundlelinks.ts"
import { signal } from "@/core/signal"
import { overConnect } from "@/core/here"
import { registerCommands } from "@/core/commands"

export type { BundleInfo, Plan, PlanChange, ShareItem }

export const isLayout = (b: BundleInfo) => b.kind === "layout"

export type Previous = { bundle: string; name: string; at: string }
type Listing = { bundles: BundleInfo[]; default: string; saveName: string; previous: Previous | null; onboarding: boolean
  trial: { id: string; name: string; at: string } | null; applied: { id: string; name: string; at: string; skip: string[] } | null }

function where(): { workspace?: number; landing?: number } {
  const n = currentWorkspace()?.n, landing = landingWorkspace()
  return n ? { workspace: n } : landing ? { landing } : {}
}
const whereQuery = () => { const q = new URLSearchParams(Object.entries(where()).map(([k, x]) => [k, String(x)])).toString(); return q ? `?${q}` : "" }

let listing: Listing | null = null
let loading: Promise<void> | null = null
const subs = signal()
const emit = () => subs.notify()

export function refreshBundles() {
  if (overConnect()) return Promise.resolve()
  loading = get<Listing>(`bundles${whereQuery()}`).then((l) => { listing = l; emit() }, (e) => { notifyError(e, "Couldn't list the bundles") }).finally(() => { loading = null })
  return loading
}

export const bundlesNow = () => listing?.bundles ?? []
export const saveNameNow = () => listing?.saveName ?? null

export function currentLayout(): BundleInfo | null {
  const all = bundlesNow().filter(isLayout)
  return (listing?.applied && all.find((b) => b.id === listing!.applied!.id)) || all.find((b) => b.inUse) || null
}

export function useBundles(): Listing | null {
  const l = subs.use(() => listing)
  useEffect(() => { if (!listing && !loading) void refreshBundles() }, [])
  return l
}

export const previousSetup = (): Previous | null => getStore()?.bundles?.previous ?? null
const onboarding = (): boolean => !!getStore()?.bundles?.onboarding

export const runsCode = (p: Plan) => p.code.some((c) => !c.kept || p.plugins.on.includes(c.id))

export const without = (p: Plan, skip: ReadonlySet<string>): Plan => !skip.size ? p : {
  ...p, code: p.code.filter((c) => !c.change || !skip.has(c.change)), plugins: { ...p.plugins, on: p.plugins.on.filter((id) => !skip.has(`plugin:${id}`)) },
}

export function lockedBy(p: Plan, off: ReadonlySet<string>): Set<string> {
  return new Set(p.code.filter((c) => c.change && off.has(c.change)).map((c) => `plugin:${c.id}`).filter((id) => p.changes.some((c) => c.id === id)))
}
export const skipOf = (p: Plan, off: ReadonlySet<string>) => [...new Set([...off, ...lockedBy(p, off)])].filter((id) => p.changes.some((c) => c.id === id))

export async function previewOf(id: string, fresh = false): Promise<{ bundle: BundleInfo; files: string[]; plan: Plan }> {
  const q = whereQuery()
  return get(`bundles/${encodeURIComponent(id)}${q}${fresh ? `${q ? "&" : "?"}fresh=1` : ""}`)
}

export type ApplyOptions = {
  allowCode?: boolean
  offAdded?: boolean
  skip?: string[]
  trial?: boolean
  fresh?: boolean
  open?: "front" | "behind" | "none"
  silent?: boolean
}

export async function applyBundle(b: BundleInfo, plan: Plan, { allowCode = false, offAdded = false, skip = [], trial = false, fresh = false, open = "front", silent = false }: ApplyOptions = {}) {
  const id = `bundle-apply-${b.id}`
  const installs = allowCode ? without(plan, new Set(skip)).code.filter((c) => c.source && !c.kept).map((c) => c.name) : []
  if (!silent && (installs.length || open !== "behind")) notify(installs.length ? `Installing ${new Intl.ListFormat("en", { type: "conjunction" }).format(installs)} for ${b.name}…` : `${trial ? "Trying" : "Applying"} ${b.name}…`, { id, duration: Infinity })
  let guide = false
  try {
    const r = await post<{ applied: string; open?: string | null }>(`bundles/${encodeURIComponent(b.id)}/apply`, { workspace: null, ...where(), allowCode, offAdded, skip, trial, fresh, quiet: open === "none" })
    await reload()
    void refreshBundles()
    if (open === "front" && r.open) openFile(r.open)
    else if (open === "behind" && r.open && r.open === b.guide) { openTab(`file:${r.open}`, { background: true }); guide = true }
  } catch (e) {
    dismissNotice(id)
    throw e
  }
  if (trial || silent) dismissNotice(id)
  else notify(guide ? `Applied ${b.name}: its guide is in a new tab` : `Applied ${b.name}`, { id, duration: 8000, action: { label: "Undo", run: () => restoreSetup() } })
}

export async function backToStandard() {
  const r = await op<{ applied: string }>("bundle.standard", { workspace: currentWorkspace()?.n ?? undefined })
  await reload()
  void refreshBundles()
  notify(`Back to ${r.applied}`, { duration: 8000, action: { label: "Undo", run: () => restoreSetup() } })
}

registerCommands([{ id: "back-to-standard", name: "Back to Standard layout", run: () => backToStandard().catch((e) => notifyError(e, "Couldn't go back to Standard")),
  icon: "undo-2", words: "reset layout sidebars lost zen" }])

export async function keepTrial() {
  await post("bundles/keep", {})
  await reload()
  void refreshBundles()
}

export async function forkBundle(b: BundleInfo, skip: string[]) {
  const r = await post<{ bundle: BundleInfo }>(`bundles/${encodeURIComponent(b.id)}/fork`, { skip, workspace: currentWorkspace()?.n ?? null })
  await refreshBundles()
  return r.bundle
}

export async function restoreSetup() {
  const r = await post<{ restored: string }>("bundles/restore", {})
  await reload()
  void refreshBundles()
  notify(`Restored the setup from before ${r.restored}`)
}

export async function skipOnboarding() {
  await post("bundles/onboarding", {})
  await reload()
  void refreshBundles()
}

export type SaveOptions = { name: string; description?: string; icon?: string; hotkeys?: boolean; vaultPlugins?: boolean; replace?: boolean }

export async function saveBundle(o: SaveOptions) {
  const r = await post<{ bundle: BundleInfo }>("bundles", { ...o, workspace: currentWorkspace()?.n ?? null })
  await refreshBundles()
  return r.bundle
}

export async function deleteBundle(b: BundleInfo) {
  await del(`bundles/${encodeURIComponent(b.id)}`)
  await refreshBundles()
}

export async function removeBundle(b: BundleInfo) {
  try {
    const copy = await bundleText(b, { all: true }).catch(() => null)
    await deleteBundle(b)
    notify(`Deleted ${b.name}`, copy ? { action: { label: "Undo", run: () => void importText(copy).catch((e) => notifyError(e, "Couldn't bring it back")) } } : {})
  } catch (e) { notifyError(e, "Couldn't delete it") }
}

export async function bundleText(b: BundleInfo, o: { all?: boolean; include?: string[]; leave?: string[] } = {}) {
  const r = await request("POST", `bundles/${encodeURIComponent(b.id)}/export`, o)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.text()
}

export const shareOf = (id: string) => get<{ items: ShareItem[]; dropped: string[] }>(`bundles/${encodeURIComponent(id)}/share`)

export const agentPrompt = (b: BundleInfo, text: string) => `This is a Vaultite bundle, "${b.name}": a setup of the Vaultite app (which plugins are on, their settings, the sidebars, \
pinned pages, the look). It has no notes. Add it to my vault: save the JSON below to a file and run \`vau bundle import <file>\`. Then run \
\`vau bundle show <id>\` and tell me what applying it would change${b.code.length ? ", and which plugins it installs (they run code)" : ""}. Don't apply it until I say so.

\`\`\`json
${text.trimEnd()}
\`\`\`
`

export async function exportBundle(b: BundleInfo, text?: string) {
  const url = URL.createObjectURL(new Blob([text ?? await bundleText(b)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `${b.id}.bundle.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function sourceOf(text: string): { file: unknown } | { from: string } | null {
  const t = text.trim()
  const link = /^(gh:|vaultite:\/\/bundle\/|(https?:\/\/)?(www\.)?vaultite\.com\/b\/)/i.test(t) ? parseRepo(t) : null
  if (link) return { from: repoText(link) }
  if (/^([\w.-]+\/[\w.-]+(\/[\w.-]+)*(@[\w.+/-]+)?|https?:\/\/\S+|git@\S+)$/.test(t)) return { from: t.replace(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/, "$1") }
  const a = t.indexOf("{"), z = t.lastIndexOf("}")
  try { return { file: JSON.parse(a >= 0 ? t.slice(a, z + 1) : t) } } catch { return null }
}

export const isBundleText = (text: string) => {
  const s = sourceOf(text)
  return !!s && ("from" in s || (typeof s.file === "object" && (s.file as { vaultite?: unknown } | null)?.vaultite === "bundle"))
}

const notABundle = (what: string) => new Error(`${what} isn't a bundle: paste its JSON, or a GitHub repository (owner/name)`)

export async function importText(text: string, what = "that") {
  const body = sourceOf(text)
  if (!body) throw notABundle(what)
  const r = await post<{ bundle: BundleInfo }>("bundles/import", body)
  await refreshBundles()
  return r.bundle
}

export type ImportSource = string | File
export type Incoming = { bundle: BundleInfo; files: string[]; plan: Plan; pages?: Record<string, { icon: string | null; tint: string | null; plugin: string | null }>
  replaces: string | null; file: unknown
  changes: { added: string[]; changed: string[]; removed: string[]; installs: { id: string; name: string; from: string | null; to: string | null }[] } | null }

export async function incomingOf(source: ImportSource): Promise<Incoming> {
  const name = typeof source === "string" ? "that" : source.name
  const body = sourceOf(typeof source === "string" ? source : await source.text())
  if (!body) throw notABundle(name)
  return post<Incoming>("bundles/import/preview", { ...body, workspace: currentWorkspace()?.n ?? null })
}

export async function addIncoming(inc: Incoming) {
  const r = await post<{ bundle: BundleInfo }>("bundles/import", { file: inc.file, replace: !!inc.replaces })
  await refreshBundles()
  return r.bundle
}

const given = new Map<string, ImportSource>()
let givenSeq = 0
export const givenImport = (key: string) => given.get(key) ?? null

export function openImport(source: ImportSource) {
  const key = String(++givenSeq)
  given.set(key, source)
  const d = route().detail
  if (d === "bundle-import" || d.startsWith("bundle-incoming/")) replaceDetail(`bundle-incoming/${key}`)
  else openDetail(`bundle-incoming/${key}`)
}

export type Listed = { name: string; description: string; author: string; repo: string; dir: string | null; commit: string; address: string; source: string
  stars: number; updated: string | null; topics: string[]; runsCode: boolean; installs: { id: string; name: string; source: string }[]
  icon?: string; tint?: string; sketch?: Sketch; imported: string | null; current: boolean
  kind?: "layout" | "pack" | "look" }
export type Directory = { url: string; available: boolean; fetched: string | null; error?: string; bundles: Listed[] }

export const browseBundles = (q: string) => get<Directory>(`bundles/browse${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)

let offered = false
export function offerWelcome() {
  if (offered || !onboarding()) return false
  offered = true
  return true
}
