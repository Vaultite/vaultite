import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Pause, Play, Volume2, VolumeX, X } from "lucide-react"
import { allPanes, cell, cn, CORNERS, selectPane, useCornerDrag, useCornerStack, useDesktop, useScopedState, useTabList, type Corner } from "@vaultite"
import { hostOf } from "./address"
import { agentPages } from "./agentpages"
import { splitArg } from "./containers"
import { SiteIcon } from "./icons"
import { muteSound, pauseSound, soundName } from "./soundmarks"
import { onScreen, settings, sounds, type Sound } from "./state"

const held = cell(new Set<number>())
const dismissed = cell(new Map<number, boolean>())

export function watchSoundCard() {
  const prune = () => {
    const by = new Map(sounds.get().map((s) => [s.id, s]))
    const h = held.get(), keep = new Set([...h].filter((id) => { const s = by.get(id); return !!s && (s.playing || s.paused) }))
    if (keep.size !== h.size) held.set(keep)
    const d = dismissed.get(), next = new Map<number, boolean>()
    for (const [id, stopped] of d) {
      const s = by.get(id)
      if (!s || !s.playing) next.set(id, true)
      else if (!stopped) next.set(id, false)
    }
    if (next.size !== d.size || [...next].some(([id, v]) => d.get(id) !== v)) dismissed.set(next)
  }
  const offs = [sounds.subscribe(prune), held.subscribe(prune), dismissed.subscribe(prune)]
  return () => { for (const off of offs) off() }
}

const wanted = (s: Sound, h: Set<number>, d: Map<number, boolean>) =>
  !!s.tab && !s.player && !d.has(s.id) && ((s.playing && !s.muted) || (h.has(s.id) && (s.paused || s.muted)))
const act = (s: Sound, f: () => void) => { held.update((h) => new Set(h).add(s.id)); f() }

export function SoundCard() {
  const desktop = useDesktop(), off = settings.use().soundCard === false, on = desktop && !off
  const all = sounds.use(), h = held.use(), d = dismissed.use()
  const some = on && all.some((s) => wanted(s, h, d))
  return some ? <Hidden list={all.filter((s) => wanted(s, h, d))} /> : null
}

const SETTLE = 600

function Hidden({ list }: { list: Sound[] }) {
  const tabs = useTabList(), seen = onScreen.use(), agents = agentPages.use()
  const here = useMemo(() => new Set(allPanes(tabs).map((p) => p.id)), [tabs])
  const out = list.filter((s) => here.has(s.tab) && !seen.has(s.id) && !agents.some((a) => a.id === s.id))
  const ids = out.map((s) => s.id).join(" ")
  const [ready, setReady] = useState("")
  useEffect(() => {
    if (!ids) { setReady(""); return }
    const t = setTimeout(() => setReady(ids), SETTLE)
    return () => clearTimeout(t)
  }, [ids])
  const shown = ready ? out.filter((s) => ready.split(" ").includes(String(s.id))) : []
  return shown.length ? createPortal(<Card list={shown} />, document.body) : null
}

const icon = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"

function Card({ list }: { list: Sound[] }) {
  const [corner, setCorner] = useScopedState<Corner>("web-viewer:sound-corner", "br", "device")
  const drag = useCornerDrag(corner, setCorner)
  const at = CORNERS[corner] ? corner : "br"
  const place = useCornerStack("sound", at, 2, drag.ref)
  const playing = list.some((s) => s.playing)
  const close = () => dismissed.update((d) => { const next = new Map(d); for (const s of list) next.set(s.id, !s.playing); return next })
  return (
    <div role="region" aria-label="Playing in hidden tabs" data-sound-card {...drag} onKeyDown={(e) => { if (e.key === "Escape") close() }}
      className={cn("glass-strong fixed z-[19] w-[320px] max-w-[calc(100vw-2rem)] touch-none overflow-hidden rounded-[12px] shadow-lg select-none",
        "transition-[left,right,margin] duration-200 ease-out data-dragging:cursor-grabbing data-dragging:shadow-2xl data-dragging:transition-none", CORNERS[at])}
      style={place}>
      <div className="flex h-8 items-center gap-1.5 pr-0.5 pl-3">
        {playing ? <Volume2 className="size-3.5 shrink-0" strokeWidth={2.25} style={{ color: "var(--web-viewer)" }} />
          : <Pause className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.25} />}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground" data-sound-card-title>
          {playing ? "Playing" : "Paused"} in {list.length === 1 ? "a hidden tab" : `${list.length} hidden tabs`}
        </span>
        <button type="button" className={icon} onClick={close} aria-label="Close" data-tip="Close" data-sound-close><X className="size-4" strokeWidth={2} /></button>
      </div>
      <ul className="flex max-h-[220px] flex-col gap-px overflow-y-auto px-1 pb-1">
        {list.map((s) => <Row key={s.id} s={s} />)}
      </ul>
    </div>
  )
}

function Row({ s }: { s: Sound }) {
  const { url } = splitArg(s.arg)
  const state = !s.playing ? "Paused" : s.muted ? "Muted" : ""
  const show = () => selectPane(s.tab)
  return (
    <li className="flex h-11 items-center gap-1 rounded-[8px] pr-0.5 hover:bg-foreground/[0.05]" data-sound-row={s.id}>
      <button type="button" onClick={show} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 pl-2 text-left">
        <SiteIcon url={url} className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[17px] font-medium">{soundName(s)}</span>
          <span className="truncate text-[12px] leading-[16px] text-muted-foreground">{state ? `${state} · ` : ""}{hostOf(url)}</span>
        </span>
      </button>
      {s.playing
        ? <button type="button" className={icon} onClick={() => act(s, () => pauseSound(s, true))} aria-label="Pause" data-tip="Pause" data-sound-pause><Pause className="size-4" strokeWidth={2} /></button>
        : s.paused && <button type="button" className={icon} onClick={() => act(s, () => pauseSound(s, false))} aria-label="Play" data-tip="Play" data-sound-play><Play className="size-4" strokeWidth={2} /></button>}
      <button type="button" className={icon} onClick={() => act(s, () => muteSound(s, !s.muted))} aria-label={s.muted ? "Unmute tab" : "Mute tab"} data-tip={s.muted ? "Unmute tab" : "Mute tab"} data-sound-mute>
        {s.muted ? <VolumeX className="size-4" strokeWidth={2} /> : <Volume2 className="size-4" strokeWidth={2} />}
      </button>
      <button type="button" className={icon} onClick={show} aria-label="Show tab" data-tip="Show tab" data-sound-show><AppWindow className="size-4" strokeWidth={2} /></button>
    </li>
  )
}
