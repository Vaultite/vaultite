import { Pause, Volume2, VolumeX } from "lucide-react"
import { AmbientButton, getTabLayout, menuAbove, allPanes, type MenuItem } from "@vaultite"
import { hostOf } from "./address"
import { splitArg } from "./containers"
import { muteItem, muteSound, soundItems, soundName } from "./soundmarks"
import { sounds, type Sound } from "./state"

const here = (s: Sound) => !!s.tab && allPanes(getTabLayout()).some((p) => p.id === s.tab)

function rowOf(s: Sound): MenuItem {
  const name = soundName(s)
  if (!here(s)) return { ...muteItem(s), label: `${s.muted ? "Unmute" : "Mute"} ${name}`, hint: "Another workspace" }
  const items = soundItems(s)
  return { label: name, icon: !s.playing ? Pause : s.muted ? VolumeX : Volume2, hint: hostOf(splitArg(s.arg).url), split: true, run: items[0].run, items }
}

export function Playing() {
  const list = sounds.use().filter((s) => s.playing || s.paused)
  if (!list.length) return null
  const loud = list.filter((s) => s.playing && !s.muted), playing = list.some((s) => s.playing)
  const name = list.length === 1 ? soundName(list[0]) : `${list.length} tabs`
  const items = (): MenuItem[] => [
    ...list.map(rowOf),
    ...(loud.length > 1 ? [{ label: "Mute all", icon: VolumeX, sep: true, run: () => { for (const s of loud) muteSound(s, true) } }] : []),
  ]
  return <AmbientButton icon={!playing ? Pause : loud.length ? Volume2 : VolumeX} tint={loud.length ? "var(--web-viewer)" : undefined} text={name}
    tip={`${!playing ? "Paused" : loud.length ? "Playing" : "Muted"}: ${name}`} onClick={(e) => menuAbove(e, items())} />
}
