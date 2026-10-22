// The status bar's "playing": while a page makes sound, which; its menu shows a page's tab or mutes it, as a tab's
// speaker does, without hunting for the tab.
import { AppWindow, Volume2, VolumeX } from "lucide-react"
import { AmbientButton, getTabLayout, menuAbove, panesOf, selectTab, webPages, type MenuItem } from "@vaultite"
import { hostOf } from "./address"
import { splitArg } from "./containers"
import { sounds, titleOf, type Sound } from "./state"

const nameOf = (s: Sound) => { const { url } = splitArg(s.arg); return s.title || titleOf(url) || hostOf(url) }
const mute = (s: Sound, on: boolean) => void webPages?.go(s.id, on ? "mute" : "unmute")
/** Its tab is in this window's workspace (else it's in another one's, or a build that doesn't say). */
const here = (s: Sound) => !!s.tab && panesOf(getTabLayout().root).some((g) => g.tabs.some((t) => t.id === s.tab))

function rowOf(s: Sound): MenuItem {
  const muted = s.muted, name = nameOf(s)
  const toggle: MenuItem = { label: muted ? "Unmute tab" : "Mute tab", icon: muted ? Volume2 : VolumeX, run: () => mute(s, !muted) }
  if (!here(s)) return { ...toggle, label: `${muted ? "Unmute" : "Mute"} ${name}`, hint: "Another workspace" }
  const show: MenuItem = { label: "Show tab", icon: AppWindow, run: () => selectTab(s.tab) }
  return { label: name, icon: muted ? VolumeX : Volume2, hint: hostOf(splitArg(s.arg).url), split: true, run: show.run, items: [show, toggle] }
}

export function Playing() {
  const list = sounds.use().filter((s) => s.playing)
  if (!list.length) return null
  const loud = list.filter((s) => !s.muted)
  const name = list.length === 1 ? nameOf(list[0]) : `${list.length} tabs`
  const items = (): MenuItem[] => [
    ...list.map(rowOf),
    ...(loud.length > 1 ? [{ label: "Mute all", icon: VolumeX, sep: true, run: () => { for (const s of loud) mute(s, true) } }] : []),
  ]
  return <AmbientButton icon={loud.length ? Volume2 : VolumeX} tint={loud.length ? "var(--web-viewer)" : undefined} text={name}
    tip={`${loud.length ? "Playing" : "Muted"}: ${name}`} onClick={(e) => menuAbove(e, items())} />
}
