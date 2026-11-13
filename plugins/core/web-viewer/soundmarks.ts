import { AppWindow, Pause, Play, Volume2, VolumeX } from "lucide-react"
import { getTabLayout, menuBelow, onTabLayoutChange, placesIn, selectPane, setUiMarks, webPages, type MenuItem, type UiMark } from "@vaultite"
import { hostOf } from "./address"
import { splitArg } from "./containers"
import { sounds, titleOf, type Sound } from "./state"

export const soundName = (s: Sound) => { const { url } = splitArg(s.arg); return s.title || titleOf(url) || hostOf(url) }
export const muteSound = (s: Sound, on: boolean) => void webPages?.go(s.id, on ? "mute" : "unmute")
export const pauseSound = (s: Sound, on: boolean) => void webPages?.go(s.id, on ? "pause" : "play")

export const pauseItems = (s: Sound): MenuItem[] => s.playing ? [{ label: "Pause", icon: Pause, run: () => pauseSound(s, true) }]
  : s.paused ? [{ label: "Play", icon: Play, run: () => pauseSound(s, false) }] : []
export const muteItem = (s: Sound): MenuItem => ({ label: s.muted ? "Unmute tab" : "Mute tab", icon: s.muted ? Volume2 : VolumeX, run: () => muteSound(s, !s.muted) })
export const soundItems = (s: Sound): MenuItem[] => [{ label: "Show tab", icon: AppWindow, run: () => selectPane(s.tab) }, ...pauseItems(s), muteItem(s)]

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

let marked = ""
function mark() {
  const l = getTabLayout(), by = new Map<string, Sound[]>()
  for (const s of sounds.get()) {
    if (!s.tab || !(s.playing || s.paused)) continue
    for (const w of [l, ...(l.windows ?? [])]) {
      const t = w.tabs.find((x) => placesIn(x).some((p) => p.id === s.tab)), g = t?.group ? w.groups?.find((x) => x.id === t.group) : undefined
      if (g?.collapsed) by.set(`group:${g.id}`, [...(by.get(`group:${g.id}`) ?? []), s])
    }
  }
  const key = [...by].map(([id, list]) => `${id} ${list.map((s) => `${s.id}:${s.playing}:${s.muted}:${s.title}`).join(",")}`).join("\n")
  if (key === marked) return
  marked = key
  setUiMarks("web-viewer", new Map([...by].map(([id, list]) => [id, [markOf(list)]])))
}

export function watchSoundMarks() {
  const offs = [sounds.subscribe(mark), onTabLayoutChange(mark)]
  mark()
  return () => { for (const off of offs) off(); marked = ""; setUiMarks("web-viewer", new Map()) }
}
