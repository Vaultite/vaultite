// Bundles in the app: its side of the API (list, preview, apply with Undo, restore, save, export, import). Format and
// applying are the server's (core/bundles.ts); the page is pages/Bundles.tsx.
import { useEffect } from "react"
import { getStore, reload } from "@/core/data"
import { del, get, post, request } from "@/core/http"
import { isDesktop } from "@/core/platform"
import { activeTab, go } from "@/core/workspace"
import { captureWindow } from "@/core/desktop"
import { openDetail, replaceDetail, route } from "@/core/nav"
import { openFile } from "@/core/files"
import { dismissNotice, notify, notifyError } from "@/core/notify"
import { currentWorkspace } from "@/core/scope"
import type { Sidebars } from "../../../core/sidebars.ts"
import { parseRepo, repoText } from "../../../core/bundlelinks.ts"
import { signal } from "@/core/signal"

export type BundleInfo = {
  id: string; source: "app" | "vault"; name: string; description: string; icon: string; tint: string; author: string; sort: number
  theme: string | null; scheme: string | null; density: string | null
  /** The app plugins on with it (null: it leaves them as they are), the pages it pins (null: the same). */
  on: string[] | null; pinned: string[] | null
  /** Its sidebars' panels (null: as they are), and the blocks of the first page it pins (null: it pins none; [] not
   *  known): what its card draws. */
  panels: { left: string[]; right: string[]; collapsed: string[] } | null
  home: { block: string; view: string | null; wide: boolean }[] | null
  /** Vault plugins it brings or installs (they run code). */
  code: string[]
  /** The repository it was imported from, or null. */
  from: string | null
  hotkeys: boolean
  /** Its preview.png's version (the card's picture), or null: the card draws a sketch. */
  preview: string | null
  problems: string[]
}
type Change = { key: string; from: unknown; to: unknown }
export type Plan = {
  /** `added`: plugins the user added that it leaves as they are (unless applied with offAdded). */
  plugins: { on: string[]; off: string[]; missing: string[]; added: string[] }
  /** `source`: where one it installs comes from (else it brings its files). */
  code: { id: string; name: string; kept: boolean; source?: string; tag?: string | null }[]
  settings: (Change & { plugin: string })[]
  skipped: { plugin: string; key: string; why: string }[]
  panels: { setup: Sidebars | null; changed: boolean; workspace: number | null }
  pins: { want: string[]; list: string[]; pin: string[]; unpin: string[]; missing: string[]; workspace: string[] | null } | null
  appearance: Change[]
  hotkeys: Change[]
  newtab: Change[]
  files: { add: string[]; kept: string[] }
  empty: boolean
}
export type Previous = { bundle: string; name: string; at: string }
/** `default`: the one a new vault starts from (Standard), and skipping the offer gives. */
type Listing = { bundles: BundleInfo[]; default: string; previous: Previous | null; onboarding: boolean }

let listing: Listing | null = null
let loading: Promise<void> | null = null
const subs = signal()
const emit = () => subs.notify()

/** Fetch the list again (after a save, an import, a delete, an apply). */
export function refreshBundles() {
  loading = get<Listing>("bundles").then((l) => { listing = l; emit() }, (e) => { notifyError(e, "Couldn't list the bundles") }).finally(() => { loading = null })
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

/** Open Bundles (the command "Choose a bundle…", Plugins) as its own page; inside Settings it's Your setup instead. */
export const openBundles = () => { if (!isDesktop()) location.hash = "#bundles"; else go("bundles") }

export async function previewOf(id: string): Promise<{ bundle: BundleInfo; files: string[]; plan: Plan }> {
  return get(`bundles/${encodeURIComponent(id)}${currentWorkspace() ? `?workspace=${currentWorkspace()!.n}` : ""}`)
}

/** Apply a bundle (the caller asked first when it runs code), then show its first page, with Undo in a toast that said
 *  it was on its way meanwhile (installing takes seconds). `offAdded`: the user's added plugins it doesn't name go off. */
export async function applyBundle(b: BundleInfo, plan: Plan, allowCode = false, offAdded = false) {
  const id = `bundle-apply-${b.id}`
  const installs = allowCode ? plan.code.filter((c) => c.source && !c.kept).map((c) => c.name) : []
  notify(installs.length ? `Installing ${new Intl.ListFormat("en", { type: "conjunction" }).format(installs)} for ${b.name}…` : `Applying ${b.name}…`, { id, duration: Infinity })
  try {
    const r = await post<{ applied: string; plan: Plan }>(`bundles/${encodeURIComponent(b.id)}/apply`, { workspace: currentWorkspace()?.n ?? null, allowCode, offAdded })
    await reload()
    void refreshBundles()
    const first = r.plan.pins?.list[0] ?? plan.pins?.list[0]
    if (first) openFile(first)
  } catch (e) {
    dismissNotice(id)
    throw e
  }
  notify(`Applied ${b.name}`, { id, duration: 8000, action: { label: "Undo", run: () => restoreSetup() } })
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

/** A bundle's card picture, when it has one. */
export const previewUrl = (b: Pick<BundleInfo, "id" | "preview">) => (b.preview ? `api/bundles/${encodeURIComponent(b.id)}/preview.png?v=${b.preview}` : null)

// The window as it was when saving began (the desktop app's), before the sheet covered it: the new bundle's picture.
let shot: string | null = null
export const takenShot = () => shot
/** Start saving the setup. A picture of the window comes first, unless what's shown is Bundles itself (or Settings). */
export async function startSave() {
  shot = null
  const to = activeTab()?.to
  if (to !== "bundles" && to !== "settings") shot = (await captureWindow().catch(() => null))?.png ?? null
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

export type ShareItem = { path: string; kind: "picture" | "page" | "file" | "settings" | "hotkeys" | "code"; label: string; on: boolean; own?: boolean; keys?: string[] }
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

/** Import a bundle from text (sourceOf): it joins the user's bundles, not applied. */
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
  replaces: string | null; file: unknown }

/** What importing a bundle would add and applying it change here, writing nothing (a repository is fetched). */
export async function incomingOf(source: ImportSource): Promise<Incoming> {
  const name = typeof source === "string" ? "that" : source.name
  const body = sourceOf(typeof source === "string" ? source : await source.text())
  if (!body) throw notABundle(name)
  return post<Incoming>("bundles/import/preview", { ...body, workspace: currentWorkspace()?.n ?? null })
}

/** Add a previewed bundle to the user's bundles, as previewed. */
export async function addIncoming(inc: Incoming) {
  const r = await post<{ bundle: BundleInfo }>("bundles/import", { file: inc.file })
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

/** A bundle's link (vaultite://bundle/<owner>/<name>, from its page on vaultite.com): its import preview. */
export const openBundleLink = (repo: string) => openImport(repo)

/** Whether App should open the bundles page by itself: a new vault being offered them (once per load). */
let offered = false
export function offerBundles() {
  if (offered || !onboarding()) return false
  offered = true
  return true
}
