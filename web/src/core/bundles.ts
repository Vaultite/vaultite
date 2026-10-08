// Bundles in the app: its side of the API (list, preview, apply with Undo, restore, save, export, import). Format and
// applying are the server's (core/bundles.ts); the page is pages/Bundles.tsx.
import { useEffect } from "react"
import { getStore, reload } from "@/core/data"
import { del, get, post, request } from "@/core/http"
import { go, isDesktop } from "@/core/workspace"
import { openFile } from "@/core/files"
import { notify, notifyError } from "@/core/notify"
import { currentWorkspace } from "@/core/scope"
import type { Sidebars } from "../../../core/sidebars.ts"
import { signal } from "@/core/signal"

export type BundleInfo = {
  id: string; source: "app" | "vault"; name: string; description: string; icon: string; tint: string; author: string; sort: number
  /** One of the app's kept under More (bundle.json's `more`). */
  more: boolean
  theme: string | null; scheme: string | null; density: string | null
  /** The app plugins on with it (null: it leaves them as they are), the pages it pins (null: the same). */
  on: string[] | null; pinned: string[] | null
  /** Its sidebars' panels (null: as they are), and the blocks of the first page it pins (null: it pins none; [] not
   *  known): what its card draws. */
  panels: { left: string[]; right: string[]; collapsed: string[] } | null
  home: { block: string; view: string | null; wide: boolean }[] | null
  /** Vault plugins it brings (they run code). */
  code: string[]
  hotkeys: boolean
  problems: string[]
}
type Change = { key: string; from: unknown; to: unknown }
export type Plan = {
  plugins: { on: string[]; off: string[]; missing: string[] }
  code: { id: string; name: string; kept: boolean }[]
  settings: (Change & { plugin: string })[]
  skipped: { plugin: string; key: string; why: string }[]
  panels: { setup: Sidebars | null; changed: boolean; workspace: number | null }
  pins: { want: string[]; list: string[]; pin: string[]; unpin: string[]; missing: string[]; workspace: string[] | null } | null
  appearance: Change[]
  hotkeys: Change[]
  files: { add: string[]; kept: string[] }
  empty: boolean
}
export type Previous = { bundle: string; name: string; at: string }
type Listing = { bundles: BundleInfo[]; previous: Previous | null; onboarding: boolean }

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

/** Open the bundles page (the command "Choose a bundle…", Settings, Plugins). */
export const openBundles = () => { if (isDesktop()) go("bundles"); else location.hash = "#bundles" }

export async function previewOf(id: string): Promise<{ bundle: BundleInfo; files: string[]; plan: Plan }> {
  return get(`bundles/${encodeURIComponent(id)}${currentWorkspace() ? `?workspace=${currentWorkspace()!.n}` : ""}`)
}

/** Apply a bundle (the caller asked first when it runs code), then show its first page, with Undo in a toast. */
export async function applyBundle(b: BundleInfo, plan: Plan, allowCode = false) {
  const r = await post<{ applied: string; plan: Plan }>(`bundles/${encodeURIComponent(b.id)}/apply`, { workspace: currentWorkspace()?.n ?? null, allowCode })
  await reload()
  void refreshBundles()
  const first = r.plan.pins?.list[0] ?? plan.pins?.list[0]
  if (first) openFile(first)
  notify(`Applied ${b.name}`, { action: { label: "Undo", run: () => restoreSetup() } })
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

export type SaveOptions = { name: string; description?: string; icon?: string; hotkeys?: boolean; vaultPlugins?: boolean; replace?: boolean }

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

/** A bundle as one JSON text (GET /api/bundles/<id>/export), what an export downloads and a delete's Undo imports. */
export async function bundleText(b: BundleInfo) {
  const r = await request("GET", `bundles/${encodeURIComponent(b.id)}/export`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.text()
}

/** Download a bundle as one JSON file (<id>.bundle.json) to share. */
export async function exportBundle(b: BundleInfo) {
  const url = URL.createObjectURL(new Blob([await bundleText(b)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `${b.id}.bundle.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Import a bundle from a file someone shared (its JSON): it joins the user's bundles, not applied. */
export async function importBundle(file: File) {
  let body: unknown
  try { body = JSON.parse(await file.text()) } catch { throw new Error(`${file.name} isn't a bundle (not JSON)`) }
  const r = await post<{ bundle: BundleInfo }>("bundles/import", body)
  await refreshBundles()
  return r.bundle
}

/** Whether App should open the bundles page by itself: a new vault being offered them (once per load). */
let offered = false
export function offerBundles() {
  if (offered || !onboarding()) return false
  offered = true
  return true
}
