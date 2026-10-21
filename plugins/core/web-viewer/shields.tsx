// Shields in the Browser: a page's count of blocked requests and its menu. The desktop app blocks (electron/browser/
// adblock.ts); the settings here are handed to it, and the parts of pages the user hid (Blocked elements, presets).
import { useEffect, useState } from "react"
import { EyeOff, MousePointerSquareDashed, Shield, ShieldOff } from "lucide-react"
import { cell, cn, getStore, menuBelow, notify, notifyError, numberText, op, openFile, openPluginSettings, useStore, webPages, type MenuItem } from "@vaultite"
import { onSite, PRESETS, type ElementRule } from "./elements"
import { settings } from "./state"

/** Requests blocked on each page (by its id), as the desktop app tells them. */
const counts = cell(new Map<number, number>())

const choice = () => { const s = settings.get(); return { on: s.shields !== false, down: s.shieldsDown ?? [] } }
const tellEngine = () => Promise.resolve(webPages?.engine?.("adblock:settings", choice())).catch(() => {})

/** The desktop app hears the settings now and as they change; the pages' counts come back (index.tsx's Background). */
export function watchShields() {
  if (!webPages?.engine) return
  void settings.ready().then(tellEngine)
  const offSettings = settings.onChange(() => void tellEngine())
  const offEvents = webPages.on((m) => {
    if (m.type !== "engine:adblock:count" || typeof m.id !== "number" || typeof m.count !== "number") return
    const id = m.id, n = m.count
    if (counts.get().get(id) !== n) counts.update((was) => new Map(was).set(id, n))
  })
  return () => { offSettings(); offEvents() }
}

// ---------- the parts of pages the user hid ----------

const NONE: never[] = []
const noteRules = () => getStore()?.blockedElements ?? NONE
/** The rules the engine gets: the note's, then those of the presets turned on. */
const allRules = (note: ElementRule[], hide: string[]) => [...note.map((r) => r.rule), ...PRESETS.filter((p) => hide.includes(p.id)).flatMap((p) => p.rules)]
const tellRules = (rules: string[]) => Promise.resolve(webPages?.engine?.("adblock:rules", rules)).catch(() => {})

/** The desktop app hears the rules now and as the note or the presets change (index.tsx's Background). */
export function useHiddenParts() {
  const note = useStore().store?.blockedElements ?? NONE
  const hide = settings.use().hide ?? NONE
  const rules = allRules(note, hide)
  const key = rules.join("\n")
  useEffect(() => { if (webPages?.engine) void tellRules(rules) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Hide a rule's elements: kept in the note (it comes back to the engine as the note changes); told now too, so the
 *  page shows it at once. */
async function hideRule(rule: string, quiet = false) {
  void tellRules([...allRules(noteRules(), settings.get().hide ?? []), rule])
  try {
    await op("web-viewer.block", { rule })
    if (!quiet) notify(`Hidden on ${siteOfRule(rule)}`, { action: { label: "Undo", run: () => void showRule(rule, true) } })
  } catch (e) { notifyError(e, "Couldn't hide it") }
}
/** Show a rule's elements again: taken out of the note. */
async function showRule(rule: string, quiet = false) {
  void tellRules(allRules(noteRules(), settings.get().hide ?? []).filter((r) => r !== rule))
  try {
    await op("web-viewer.unblock", { rule })
    if (!quiet) notify(`Showing it again on ${siteOfRule(rule)}`, { action: { label: "Undo", run: () => void hideRule(rule, true) } })
  } catch (e) { notifyError(e, "Couldn't show it again") }
}
const siteOfRule = (rule: string) => rule.slice(0, rule.indexOf("##")).split(",").find((s) => s && !s.startsWith("~")) || "every site"

/** Block an element on page `id`: the picker in the page (starting on the element at `point`, a right-click's), then
 *  its rule kept for `site`. */
export async function pickElement(id: number, site?: string, point?: { x: number; y: number }) {
  if (!webPages?.engine || !id) return
  try {
    const at = site ?? ((await webPages.engine("adblock:page", id)) as PageShields | null)?.site ?? ""
    const r = (await webPages.engine("adblock:pick", id, at, point)) as { selector: string } | null
    if (r?.selector) await hideRule(`${at}##${r.selector}`)
  } catch (e) { notifyError(e, "Couldn't block it") }
}

/** The Shields menu's part for the hidden parts of `site`: Block an element, its presets, and the user's rules there. */
function hiddenItems(id: number, site: string, note: ElementRule[], hide: string[]): MenuItem[] {
  const mine = note.filter((r) => r.site && onSite(site, r.site))
  const presets = PRESETS.filter((p) => onSite(site, p.site))
  const setPreset = (pid: string, on: boolean) => {
    const next = [...(settings.get().hide ?? []).filter((x) => x !== pid), ...(on ? [pid] : [])]
    void settings.set({ hide: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
  }
  const path = note.length ? getStore()?.files.files.find((f) => f.type === "blocked-elements")?.path : undefined
  return [
    { label: "Block an element…", icon: MousePointerSquareDashed, sep: true, run: () => void pickElement(id, site) },
    ...presets.map((p): MenuItem => ({ label: p.name, checked: hide.includes(p.id), keep: true, run: () => setPreset(p.id, !(settings.get().hide ?? []).includes(p.id)) })),
    ...(mine.length ? [{ label: `Hidden on ${site}`, icon: EyeOff, hint: numberText(mine.length), run: () => {}, items: [
      { caption: true, label: "Click one to show it again", run: () => {} },
      ...mine.map((r): MenuItem => ({ label: r.rule.slice(r.rule.indexOf("##") + 2), checked: true, run: () => void showRule(r.rule) })),
      ...(path ? [{ label: "Open the list", sep: true, run: () => openFile(path) }] : []),
    ] }] : []),
  ]
}

type PageShields = { site: string; count: number }

/** Shields, at the address's right: what was blocked on the page, and a menu to take them down for its site. */
export function ShieldsButton({ id, url }: { id: number; url: string }) {
  const [page, setPage] = useState<PageShields | null>(null)
  const told = counts.use((m) => m.get(id))
  const s = settings.use()
  const note = useStore().store?.blockedElements ?? NONE
  useEffect(() => {
    let gone = false
    void Promise.resolve(webPages?.engine?.("adblock:page", id)).then((r) => { if (!gone) setPage((r as PageShields | null) ?? null) }, () => {})
    return () => { gone = true }
  }, [id, url])
  if (!webPages?.engine || !page?.site) return null
  const { site } = page
  const count = told ?? page.count
  const on = s.shields !== false
  const down = s.shieldsDown ?? []
  const up = on && !down.includes(site)

  const reload = () => { void webPages?.go(id, "reload") }
  const setDown = async (yes: boolean) => {
    const next = down.filter((x) => x !== site).concat(yes ? [site] : [])
    try { await settings.set({ shieldsDown: next.length ? next : null }) } catch (e) { notifyError(e, "Couldn't change Shields"); return }
    await tellEngine()
    reload()
  }
  const turnOn = async () => {
    try { await settings.set({ shields: null }) } catch (e) { notifyError(e, "Couldn't turn on Shields"); return }
    await tellEngine()
    reload()
  }
  const menu = (): MenuItem[] => [
    { caption: true, label: !on ? "Shields are off for every site" : !up ? `Nothing is blocked on ${site}`
      : count ? `${numberText(count)} ${count === 1 ? "request" : "requests"} blocked on this page` : "Nothing blocked on this page", run: () => {} },
    on ? { label: `Shields for ${site}`, checked: up, run: () => void setDown(up) } : { label: "Shields", checked: false, run: () => void turnOn() },
    ...hiddenItems(id, site, note, s.hide ?? []),
    { label: "Browser settings…", sep: true, run: () => openPluginSettings("web-viewer", "shields") },
  ]
  const Icon = up ? Shield : ShieldOff
  return (
    <button type="button" aria-label={up && count > 0 ? `Shields: ${numberText(count)} blocked` : "Shields"} aria-haspopup="menu" data-tip="Shields"
      data-web-shields={up ? "up" : "down"} data-count={count} onClick={(e) => menuBelow(e, menu())}
      className={cn("flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-[12px] tabular-nums hover:bg-foreground/[0.07] hover:text-foreground",
        up ? "text-muted-foreground" : "text-tertiary")}>
      <Icon className="size-3.5" strokeWidth={2} />
      {up && count > 0 && <span className="@max-md/bar:hidden">{numberText(count)}</span>}
    </button>
  )
}
