import { useEffect, useState } from "react"
import { EyeOff, FileText, Moon, MousePointerSquareDashed, Paintbrush, Settings2, Shield, ShieldOff } from "lucide-react"
import { cell, cn, getStore, menuBelow, notify, notifyError, numberText, op, openFile, openPluginSettings, useStore, webPages, type MenuItem } from "@vaultite"
import { BLOCKED, onSite, PRESETS, type ElementRule } from "./elements"
import { siteName, type SiteStyle } from "./sitestyles"
import { settings } from "./state"
import { darkPagesOn, editStyle, setDark, setStyled, styleOf } from "./stylestate"
import { engine, type PageShields } from "./engine"

const counts = cell(new Map<number, number>())

const choice = () => { const s = settings.get(); return { on: s.shields !== false, down: s.shieldsDown ?? [] } }
const tellEngine = () => Promise.resolve(webPages?.engine?.("adblock:settings", choice())).catch(() => {})

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


const NONE: never[] = []
const noteRules = () => getStore()?.blockedElements ?? NONE
const allRules = (note: ElementRule[], hide: string[]) => [...note.map((r) => r.rule), ...PRESETS.filter((p) => hide.includes(p.id)).flatMap((p) => p.rules)]
const tellRules = (rules: string[]) => Promise.resolve(webPages?.engine?.("adblock:rules", rules)).catch(() => {})

export function useHiddenParts() {
  const note = useStore().store?.blockedElements ?? NONE
  const hide = settings.use().hide ?? NONE
  const rules = allRules(note, hide)
  const key = rules.join("\n")
  useEffect(() => { if (webPages?.engine) void tellRules(rules) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

async function hideRule(rule: string, quiet = false) {
  void tellRules([...allRules(noteRules(), settings.get().hide ?? []), rule])
  try {
    await op("web-viewer.block", { rule })
    if (!quiet) notify(`Hidden on ${siteOfRule(rule)}`, { action: { label: "Undo", run: () => void showRule(rule, true) } })
  } catch (e) { notifyError(e, "Couldn't hide it") }
}
async function showRule(rule: string, quiet = false) {
  void tellRules(allRules(noteRules(), settings.get().hide ?? []).filter((r) => r !== rule))
  try {
    await op("web-viewer.unblock", { rule })
    if (!quiet) notify(`Showing it again on ${siteOfRule(rule)}`, { action: { label: "Undo", run: () => void hideRule(rule, true) } })
  } catch (e) { notifyError(e, "Couldn't show it again") }
}
const siteOfRule = (rule: string) => rule.slice(0, rule.indexOf("##")).split(",").find((s) => s && !s.startsWith("~")) || "every site"

export async function pickElement(id: number, site?: string, point?: { x: number; y: number }) {
  if (!webPages?.engine || !id) return
  try {
    const at = site ?? (await engine("adblock:page", id))?.site ?? ""
    const r = await engine("adblock:pick", id, at, point)
    if (r?.selector) await hideRule(`${at}##${r.selector}`)
  } catch (e) { notifyError(e, "Couldn't block it") }
}

function hiddenItems(id: number, site: string, note: ElementRule[], hide: string[]): MenuItem[] {
  const mine = note.filter((r) => r.site && onSite(site, r.site))
  const presets = PRESETS.filter((p) => onSite(site, p.site))
  const setPreset = (pid: string, on: boolean) => {
    const next = [...(settings.get().hide ?? []).filter((x) => x !== pid), ...(on ? [pid] : [])]
    void settings.set({ hide: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
  }
  return [
    { label: "Block an element…", icon: MousePointerSquareDashed, sep: true, run: () => void pickElement(id, site) },
    ...presets.map((p): MenuItem => ({ label: p.name, icon: EyeOff, checked: hide.includes(p.id), keep: true, run: () => setPreset(p.id, !(settings.get().hide ?? []).includes(p.id)) })),
    ...(mine.length ? [{ label: `Hidden on ${site}`, icon: EyeOff, hint: numberText(mine.length), run: () => {}, items: [
      { caption: true, label: "Click one to show it again", run: () => {} },
      ...mine.map((r): MenuItem => ({ label: r.rule.slice(r.rule.indexOf("##") + 2), checked: true, run: () => void showRule(r.rule) })),
      { label: "Open the list", icon: FileText, sep: true, run: () => openFile(BLOCKED) },
    ] }] : []),
  ]
}

function styleItems(url: string, styles: SiteStyle[], unstyled: string[]): MenuItem[] {
  const host = siteName(url)
  if (!host) return []
  const style = styleOf(styles, host)
  if (!style) return [{ label: "Style this site…", icon: Paintbrush, sep: true, run: () => void editStyle(host) }]
  const on = !unstyled.includes(style.site)
  return [
    { label: `Style for ${style.site}`, icon: Paintbrush, checked: on, sep: true, run: () => setStyled(style.site, !on) },
    { label: "Edit its style…", icon: FileText, run: () => void editStyle(style.site) },
  ]
}

function darkItems(url: string, off: string[]): MenuItem[] {
  const host = siteName(url)
  if (!host || !darkPagesOn()) return []
  const on = !off.some((s) => host === s || host.endsWith(`.${s}`))
  return [{ label: `Dark pages for ${host}`, icon: Moon, checked: on, run: () => setDark(host, !on) }]
}


export function ShieldsButton({ id, url, loading }: { id: number; url: string; loading?: boolean }) {
  const [page, setPage] = useState<PageShields | null>(null)
  const told = counts.use((m) => m.get(id))
  const s = settings.use()
  const note = useStore().store?.blockedElements ?? NONE
  const styles = useStore().store?.siteStyles ?? NONE
  useEffect(() => {
    let gone = false
    void engine("adblock:page", id).then((r) => { if (!gone) setPage(r ?? null) }, () => {})
    return () => { gone = true }
  }, [id, url, loading])
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
    on ? { label: `Shields for ${site}`, icon: Shield, checked: up, run: () => void setDown(up) } : { label: "Shields", icon: Shield, checked: false, run: () => void turnOn() },
    ...hiddenItems(id, site, note, s.hide ?? []),
    ...styleItems(url, styles, s.unstyled ?? []),
    ...darkItems(url, s.darkPagesOff ?? []),
    { label: "Browser settings…", icon: Settings2, sep: true, run: () => openPluginSettings("web-viewer", "shields") },
  ]
  const Icon = up ? Shield : ShieldOff
  return (
    <button type="button" aria-label={up && count > 0 ? `Shields: ${numberText(count)} blocked` : "Shields"} aria-haspopup="menu" data-tip="Shields"
      data-web-shields={up ? "up" : "down"} data-count={count} onClick={(e) => menuBelow(e, menu())}
      className={cn("flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] hover:bg-foreground/[0.07] hover:text-foreground",
        up ? "text-muted-foreground" : "text-tertiary")}>
      <Icon className="size-3.5" strokeWidth={2} />
    </button>
  )
}
