// Bundles in the app: its side of the API (list, preview, apply with Undo, restore, save, export, import). Format and
// applying are the server's (core/bundles.ts); the page is Setup's Bundles tab (pages/Bundles.tsx).
import { useEffect, useSyncExternalStore } from "react"
import { getStore, reload } from "@/core/data"
import { del, get, post, request } from "@/core/http"
import { activeTab } from "@/core/workspace"
import { appPageOf } from "@/core/apppages"
import { captureWindow } from "@/core/desktop"
import { afterSheets, openDetail, replaceDetail, route } from "@/core/nav"
import { openFile } from "@/core/files"
import { dismissNotice, notify, notifyError } from "@/core/notify"
import { currentWorkspace, landingWorkspace } from "@/core/scope"
import type { Info as BundleInfo, Plan, PlanChange, ShareItem } from "../../../core/bundles.ts"
import { parseRepo, repoText } from "../../../core/bundlelinks.ts"
import { signal } from "@/core/signal"
import { onLook } from "@/core/appearance"
import { isDark } from "@/lib/utils"

export type { BundleInfo, Plan, PlanChange, ShareItem }

export type Previous = { bundle: string; name: string; at: string }
/** `default`: the one a new vault starts from (Standard), and skipping the offer gives; `trial`: one being tried;
 *  `applied`: the one applied last. */
type Listing = { bundles: BundleInfo[]; default: string; previous: Previous | null; onboarding: boolean
  trial: { id: string; name: string; at: string } | null; applied: { id: string; name: string; at: string; skip: string[] } | null }

/** The workspace a plan or an apply is for: the current one, else the one the window goes to if the bundle turns
 *  Workspaces on (`landing`: its own panels and pins would show instead of the bundle's). */
function where(): { workspace?: number; landing?: number } {
  const n = currentWorkspace()?.n, landing = landingWorkspace()
  return n ? { workspace: n } : landing ? { landing } : {}
}
const whereQuery = () => { const q = new URLSearchParams(Object.entries(where()).map(([k, x]) => [k, String(x)])).toString(); return q ? `?${q}` : "" }

let listing: Listing | null = null
let loading: Promise<void> | null = null
const subs = signal()
const emit = () => subs.notify()

/** Fetch the list again (after a save, an import, a delete, an apply; the page shown: what's in use may have changed). */
export function refreshBundles() {
  loading = get<Listing>(`bundles${whereQuery()}`).then((l) => { listing = l; emit() }, (e) => { notifyError(e, "Couldn't list the bundles") }).finally(() => { loading = null })
  return loading
}

/** The bundles there are (null while they load). */
export function useBundles(): Listing | null {
  const l = subs.use(() => listing)
  useEffect(() => { if (!listing && !loading) void refreshBundles() }, [])
  return l
}

/** The setup a bundle replaced, from /api/state (the store's `bundles`). */
export const previousSetup = (): Previous | null => getStore()?.bundles?.previous ?? null
/** A vault opened for the first time that hasn't picked a setup yet. */
const onboarding = (): boolean => !!getStore()?.bundles?.onboarding

/** Applying it puts code in the vault or turns a vault plugin on (core/bundles.ts runsCode). */
export const runsCode = (p: Plan) => p.code.some((c) => !c.kept || p.plugins.on.includes(c.id))

/** The plan without the changes `skip` names, as far as asking about code goes: what it installs, and turns on. */
export const without = (p: Plan, skip: ReadonlySet<string>): Plan => !skip.size ? p : {
  ...p, code: p.code.filter((c) => !c.change || !skip.has(c.change)), plugins: { ...p.plugins, on: p.plugins.on.filter((id) => !skip.has(`plugin:${id}`)) },
}

/** Changes that go with another, by id: a plugin turned on whose install is left out isn't there to turn on
 *  (core/bundles.ts plan). */
export function lockedBy(p: Plan, off: ReadonlySet<string>): Set<string> {
  return new Set(p.code.filter((c) => c.change && off.has(c.change)).map((c) => `plugin:${c.id}`).filter((id) => p.changes.some((c) => c.id === id)))
}
/** What applying leaves out: the changes unticked, and those that go with them. */
export const skipOf = (p: Plan, off: ReadonlySet<string>) => [...new Set([...off, ...lockedBy(p, off)])].filter((id) => p.changes.some((c) => c.id === id))


export async function previewOf(id: string): Promise<{ bundle: BundleInfo; files: string[]; plan: Plan }> {
  return get(`bundles/${encodeURIComponent(id)}${whereQuery()}`)
}

export type ApplyOptions = {
  /** The caller asked first: it runs code. */
  allowCode?: boolean
  /** The user's added plugins it doesn't name go off. */
  offAdded?: boolean
  /** Change ids left out (skipOf). */
  skip?: string[]
  /** Only tried: the app-wide bar keeps it or reverts (BundleTrial). */
  trial?: boolean
}

/** Apply a bundle, then show its guide or first page, with Undo in a toast that said it was on its way meanwhile
 *  (installing takes seconds); a trial ends without one, its bar says it. */
export async function applyBundle(b: BundleInfo, plan: Plan, { allowCode = false, offAdded = false, skip = [], trial = false }: ApplyOptions = {}) {
  const id = `bundle-apply-${b.id}`
  const installs = allowCode ? without(plan, new Set(skip)).code.filter((c) => c.source && !c.kept).map((c) => c.name) : []
  notify(installs.length ? `Installing ${new Intl.ListFormat("en", { type: "conjunction" }).format(installs)} for ${b.name}…` : `${trial ? "Trying" : "Applying"} ${b.name}…`, { id, duration: Infinity })
  try {
    const r = await post<{ applied: string; plan: Plan }>(`bundles/${encodeURIComponent(b.id)}/apply`, { workspace: null, ...where(), allowCode, offAdded, skip, trial })
    await reload()
    void refreshBundles()
    // A guide it just added comes first: the pages it pins are linked from there.
    const first = (b.guide && r.plan.files.add.includes(b.guide) ? b.guide : null) ?? r.plan.pins?.list[0] ?? plan.pins?.list[0]
    if (first) openFile(first)
  } catch (e) {
    dismissNotice(id)
    throw e
  }
  if (trial) dismissNotice(id)
  else notify(`Applied ${b.name}`, { id, duration: 8000, action: { label: "Undo", run: () => restoreSetup() } })
}

/** End a trial keeping the bundle tried (Restore still goes back to before it). */
export async function keepTrial() {
  await post("bundles/keep", {})
  await reload()
  void refreshBundles()
}

/** Save a bundle without the changes `skip` names as the user's "<Name> (mine)". */
export async function forkBundle(b: BundleInfo, skip: string[]) {
  const r = await post<{ bundle: BundleInfo }>(`bundles/${encodeURIComponent(b.id)}/fork`, { skip, workspace: currentWorkspace()?.n ?? null })
  await refreshBundles()
  return r.bundle
}

/** Keep the setup's changes since bundle b was applied: saved over it when it's the user's (with a new picture when
 *  the desktop app takes one), else as a new "<Name> (mine)". Closes the sheet first, so the picture is of the app. */
export async function saveChanges(b: BundleInfo) {
  await new Promise<void>((done) => afterSheets(() => requestAnimationFrame(() => done())))
  const png = b.source === "vault" ? await windowShot() : null
  const r = await post<{ bundle: BundleInfo }>("bundles", { over: b.id, workspace: currentWorkspace()?.n ?? null, ...(png ? { preview: png } : {}) })
  await refreshBundles()
  return r.bundle
}

/** Put back the setup from before the last bundle applied. */
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

export type SaveOptions = { name: string; description?: string; icon?: string; hotkeys?: boolean; vaultPlugins?: boolean; replace?: boolean
  /** The card's picture: a PNG as base64. */
  preview?: string }

/** A bundle's card picture as the app looks now: its dark one while dark, each the other's fallback; null: it has none
 *  (the card draws a sketch). `file`: an import's export, which holds them (it isn't among the bundles yet). */
export function usePicture(b: Pick<BundleInfo, "id" | "preview" | "previewDark">, file?: unknown): string | null {
  const dark = useSyncExternalStore(onLook, isDark)
  const [name, v] = (dark && b.previewDark) || !b.preview ? ["preview-dark.png", b.previewDark] : ["preview.png", b.preview]
  if (!v) return null
  const inline = (file as { files?: Record<string, { base64?: string } | undefined> } | undefined)?.files?.[name]?.base64
  return inline ? `data:image/png;base64,${inline}` : `api/bundles/${encodeURIComponent(b.id)}/${name}?v=${v}`
}

/** The desktop app's picture of the window, for a bundle's card: none of Setup itself (or Settings), nor in a browser. */
const windowShot = async () => (appPageOf(activeTab()?.to ?? "") ? null : (await captureWindow().catch(() => null))?.png ?? null)

// The window as it was when saving began, before the sheet covered it: the new bundle's picture.
let shot: string | null = null
export const takenShot = () => shot
/** Start saving the setup. A picture of the window comes first. */
export async function startSave() {
  shot = await windowShot()
  openDetail("bundle-save")
}

/** Save the current setup as one of the user's bundles (the current workspace's panels and pins when it has its own). */
export async function saveBundle(o: SaveOptions) {
  const r = await post<{ bundle: BundleInfo }>("bundles", { ...o, workspace: currentWorkspace()?.n ?? null })
  await refreshBundles()
  return r.bundle
}

export async function deleteBundle(b: BundleInfo) {
  await del(`bundles/${encodeURIComponent(b.id)}`)
  await refreshBundles()
  notify(`Deleted ${b.name} (it's in the trash)`)
}

/** A bundle as one JSON text (core/bundles.ts shared): its parts chosen to share (`include`, `leave`), or `all` of it
 *  (what a delete's Undo imports). */
export async function bundleText(b: BundleInfo, o: { all?: boolean; include?: string[]; leave?: string[] } = {}) {
  const r = await request("POST", `bundles/${encodeURIComponent(b.id)}/export`, o)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.text()
}

/** Its parts to share or leave out, and the pins to the user's own notes it never sends. */
export const shareOf = (id: string) => get<{ items: ShareItem[]; dropped: string[] }>(`bundles/${encodeURIComponent(id)}/share`)

/** What Copy for an agent puts before the bundle: what it is and how to add it, applied only once the user says. */
export const agentPrompt = (b: BundleInfo, text: string) => `This is a Vaultite bundle, "${b.name}": a setup of the Vaultite app (which plugins are on, their settings, the sidebars, \
pinned pages, the look). It has no notes. Add it to my vault: save the JSON below to a file and run \`vau bundle import <file>\`. Then run \
\`vau bundle show <id>\` and tell me what applying it would change${b.code.length ? ", and which plugins it installs (they run code)" : ""}. Don't apply it until I say so.

\`\`\`json
${text.trimEnd()}
\`\`\`
`

/** Download a bundle as one JSON file (<id>.bundle.json) to share: `text` as chosen, else shared as it is by default. */
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

/** What an import is given, from text: a bundle's JSON (pasted, maybe inside a message: from its first { to its last },
 *  as `{file}`), or a git repository (owner/name, a URL: `{from}`), fetched by the server. Null when it's neither. */
export function sourceOf(text: string): { file: unknown } | { from: string } | null {
  const t = text.trim()
  // (a bundle's link names its repository: core/bundlelinks.ts)
  const link = /^(gh:|vaultite:\/\/bundle\/|(https?:\/\/)?(www\.)?vaultite\.com\/b\/)/i.test(t) ? parseRepo(t) : null
  if (link) return { from: repoText(link) }
  if (/^([\w.-]+\/[\w.-]+(\/[\w.-]+)*(@[\w.+/-]+)?|https?:\/\/\S+|git@\S+)$/.test(t)) return { from: t.replace(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/, "$1") }
  const a = t.indexOf("{"), z = t.lastIndexOf("}")
  try { return { file: JSON.parse(a >= 0 ? t.slice(a, z + 1) : t) } } catch { return null }
}

/** Text that names a bundle: its JSON ("vaultite": "bundle"), or a repository. What a paste on the Bundles page takes. */
export const isBundleText = (text: string) => {
  const s = sourceOf(text)
  return !!s && ("from" in s || (typeof s.file === "object" && (s.file as { vaultite?: unknown } | null)?.vaultite === "bundle"))
}

const notABundle = (what: string) => new Error(`${what} isn't a bundle: paste its JSON, or a GitHub repository (owner/name)`)

/** Import a bundle from text (sourceOf): it joins the user's bundles, not applied. Never over one of theirs (409): an
 *  update goes through its preview (openImport), which says what changed. */
export async function importText(text: string, what = "that") {
  const body = sourceOf(text)
  if (!body) throw notABundle(what)
  const r = await post<{ bundle: BundleInfo }>("bundles/import", body)
  await refreshBundles()
  return r.bundle
}

/** A bundle given to the app (pasted, dropped, a link): text as importText takes it, or its file. */
export type ImportSource = string | File
/** An import's preview (core/bundles.ts incoming): the bundle as it would be added, what applying it would change,
 *  the bundle of the user's it replaces (one from the same repository), and `file`: it as an export, to add. */
export type Incoming = { bundle: BundleInfo; files: string[]; plan: Plan; pages?: Record<string, { icon: string | null; tint: string | null; plugin: string | null }>
  replaces: string | null; file: unknown
  /** An update (`replaces`): what's different from the user's copy. */
  changes: { added: string[]; changed: string[]; removed: string[]; installs: { id: string; name: string; from: string | null; to: string | null }[] } | null }

/** What importing a bundle would add and applying it change here, writing nothing (a repository is fetched). */
export async function incomingOf(source: ImportSource): Promise<Incoming> {
  const name = typeof source === "string" ? "that" : source.name
  const body = sourceOf(typeof source === "string" ? source : await source.text())
  if (!body) throw notABundle(name)
  return post<Incoming>("bundles/import/preview", { ...body, workspace: currentWorkspace()?.n ?? null })
}

/** Add a previewed bundle to the user's bundles, as previewed (replacing theirs from the same repository: the preview
 *  said so). */
export async function addIncoming(inc: Incoming) {
  const r = await post<{ bundle: BundleInfo }>("bundles/import", { file: inc.file, replace: !!inc.replaces })
  await refreshBundles()
  return r.bundle
}

// What each import sheet was given (bundle-incoming/<n>): kept here, not in the address (a bundle's JSON can be MBs).
const given = new Map<string, ImportSource>()
let givenSeq = 0
export const givenImport = (key: string) => given.get(key) ?? null

/** Open the import flow on a bundle given to the app (pasted, dropped, a vaultite://bundle link, a demo's link): its
 *  preview, which says what it would change, then Apply or Add. It takes the place of the Import sheet when that's open. */
export function openImport(source: ImportSource) {
  const key = String(++givenSeq)
  given.set(key, source)
  const d = route().detail
  if (d === "bundle-import" || d.startsWith("bundle-incoming/")) replaceDetail(`bundle-incoming/${key}`)
  else openDetail(`bundle-incoming/${key}`)
}

// ---------- the directory: bundles shared on GitHub (core/pluginindex.ts) ----------

/** A bundle the directory lists, pinned at `commit` (`address`: owner/name[/folder]@commit, what importing takes);
 *  `imported`: the user's bundle from the same place, `current`: it's at that commit. */
export type Listed = { name: string; description: string; author: string; repo: string; dir: string | null; commit: string; address: string; source: string
  stars: number; updated: string | null; topics: string[]; runsCode: boolean; installs: { id: string; name: string; source: string }[]
  icon?: string; tint?: string; preview?: string; previewDark?: string; imported: string | null; current: boolean }
/** `available`: the index could be read (else `error` says why; offline, say). */
export type Directory = { url: string; available: boolean; fetched: string | null; error?: string; bundles: Listed[] }

/** The directory's bundles with these words. */
export const browseBundles = (q: string) => get<Directory>(`bundles/browse${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)

/** A listed bundle's picture as the app looks now (each stands in for the other), or null. */
export function useListedPicture(e: Pick<Listed, "preview" | "previewDark">): string | null {
  const dark = useSyncExternalStore(onLook, isDark)
  return (dark ? e.previewDark ?? e.preview : e.preview ?? e.previewDark) ?? null
}

/** Whether App should open the bundles page by itself: a new vault being offered them (once per load). */
let offered = false
export function offerBundles() {
  if (offered || !onboarding()) return false
  offered = true
  return true
}
