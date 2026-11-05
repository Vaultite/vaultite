// A page playing where its tab can't be seen (in a folded tab group): a speaker on the group's row and chip (core/
// uimarks.ts), a click from showing, pausing or muting it; and the sound items the tab's menus and the status bar share.
import { AppWindow, Pause, Play, Volume2, VolumeX } from "lucide-react"
import { getTabLayout, menuBelow, onTabLayoutChange, panesOf, selectPane, setUiMarks, webPages, type MenuItem, type UiMark } from "@vaultite"
import { hostOf } from "./address"
import { splitArg } from "./containers"
import { sounds, titleOf, type Sound } from "./state"

export const soundName = (s: Sound) => { const { url } = splitArg(s.arg); return s.title || titleOf(url) || hostOf(url) }
export const muteSound = (s: Sound, on: boolean) => void webPages?.go(s.id, on ? "mute" : "unmute")
/** Its media paused (`on`), or the media it paused started again. */
export const pauseSound = (s: Sound, on: boolean) => void webPages?.go(s.id, on ? "pause" : "play")

/** Pause while it plays, Play once the app paused it; nothing for a page only muted. */
export const pauseItems = (s: Sound): MenuItem[] => s.playing ? [{ label: "Pause", icon: Pause, run: () => pauseSound(s, true) }]
  : s.paused ? [{ label: "Play", icon: Play, run: () => pauseSound(s, false) }] : []
export const muteItem = (s: Sound): MenuItem => ({ label: s.muted ? "Unmute tab" : "Mute tab", icon: s.muted ? Volume2 : VolumeX, run: () => muteSound(s, !s.muted) })
/** A page's sound menu: its tab shown, paused or played, muted or not. */
export const soundItems = (s: Sound): MenuItem[] => [{ label: "Show tab", icon: AppWindow, run: () => selectPane(s.tab) }, ...pauseItems(s), muteItem(s)]

/** A folded group's mark: one page's speaker (a pause sign once the app paused it), or how many play. */
function markOf(list: Sound[]): UiMark {
  const loud = list.some((s) => s.playing && !s.muted), playing = list.some((s) => s.playing), one = list.length === 1 ? list[0] : null
  const what = playing ? "Playing" : "Paused"
  return {
    icon: !playing ? Pause : loud ? Volume2 : VolumeX, tint: loud ? "var(--web-viewer)" : "var(--muted-foreground)",
    label: one ? `${what}: ${soundName(one)}` : `${what}: ${list.length} tabs`,
    run: (e) => menuBelow(e, one ? soundItems(one) : list.map((s) => ({ label: soundName(s), icon: s.playing ? (s.muted ? VolumeX : Volume2) : Pause, split: true,
      run: () => selectPane(s.tab), items: soundItems(s) }))),
  }
}

/** What the marks were last set from: set again only when it changes. */
let marked = ""
function mark() {
  const l = getTabLayout(), by = new Map<string, Sound[]>()
  for (const s of sounds.get()) {
    if (!s.tab || !(s.playing || s.paused)) continue
    for (const w of [l, ...(l.windows ?? [])]) {
      const t = w.tabs.find((x) => panesOf(x).some((p) => p.id === s.tab)), g = t?.group ? w.groups?.find((x) => x.id === t.group) : undefined
      if (g?.collapsed) by.set(`group:${g.id}`, [...(by.get(`group:${g.id}`) ?? []), s])
    }
  }
  const key = [...by].map(([id, list]) => `${id} ${list.map((s) => `${s.id}:${s.playing}:${s.muted}:${s.title}`).join(",")}`).join("\n")
  if (key === marked) return
  marked = key
  setUiMarks("web-viewer", new Map([...by].map(([id, list]) => [id, [markOf(list)]])))
}

/** Mark the folded groups as pages play and tabs move; returns how to stop. */
export function watchSoundMarks() {
  const offs = [sounds.subscribe(mark), onTabLayoutChange(mark)]
  mark()
  return () => { for (const off of offs) off(); marked = ""; setUiMarks("web-viewer", new Map()) }
}
