import { useMemo, useState } from "react"
import { flushSync } from "react-dom"
import { available, commandName, isOn, isSetting, keysOf, recentCommands, runCommand, runOrSay, useCommandList, type Command } from "@/core/commands"
import { useSwitches } from "@/core/switches"
import { commandIcon } from "@/core/pages"
import { isEnabled, names, offWithAi, pluginById, setSwitch, switchedOn, usePlugins, type Plugin } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { notify } from "@/core/notify"
import { fuzzy, hasWords } from "@/core/fuzzy"
import { rankCommands } from "@/core/paletterank"
import { Keys, marked, NoMatches, Palette, useFinderQuery } from "@/components/Palette"
import { cn } from "@/lib/utils"

type Row = Command & { marks: number[]; plugin?: "on" | "off" }

const TURN_ON = "Turn on ", TURN_OFF = "Turn off "
const listed = (ids: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(ids.map((i) => names([i])))

function toSwitch(p: Plugin, seen: string[] = []): Plugin[] | null {
  if (p.tier === "hosted" || p.problems?.length || seen.includes(p.id)) return null
  const out = switchedOn(p) ? [] : [p]
  for (const r of p.requires ?? []) {
    const q = pluginById(r)
    if (!q) return null
    if (isEnabled(r, getPrefs().disabled)) continue
    const more = toSwitch(q, [...seen, p.id])
    if (!more) return null
    out.push(...more.filter((x) => !out.includes(x)))
  }
  return out
}

function turnOn(p: Plugin, list: Plugin[]) {
  for (const x of list) setSwitch(x, true)
  const also = list.filter((x) => x !== p).map((x) => x.id)
  notify(`${p.name} is on${also.length ? `, and ${listed(also)}` : ""}`, { action: { label: "Undo", run: () => { for (const x of list) setSwitch(x, false) } } })
}

function turnOff(p: Plugin, all: Plugin[], disabled: string[]) {
  const gone = all.filter((x) => x !== p && isEnabled(x.id, disabled) && needs(x, p.id)).map((x) => x.id)
  setSwitch(p, false)
  notify(`${p.name} is off${gone.length ? `, and ${listed(gone)} with it` : ""}`, { action: { label: "Undo", run: () => setSwitch(p, true) } })
}
const needs = (x: Plugin, id: string, seen: string[] = []): boolean =>
  !seen.includes(x.id) && (x.requires ?? []).some((r) => r === id || (!!pluginById(r) && needs(pluginById(r)!, id, [...seen, x.id])))

function pluginRows(all: Plugin[], disabled: string[], typed: string): Row[] {
  const verb = /^(turn on|enable|turn off|disable)\b\s*/i.exec(typed)
  const off = !!verb && /off|disable/i.test(verb[1])
  const q = verb ? typed.slice(verb[0].length) : typed
  if (!verb && q.length < 2) return []
  const say = off ? TURN_OFF : TURN_ON
  return all.flatMap((p) => {
    if (p.alwaysOn || p.switchIn || offWithAi(p) || isEnabled(p.id, disabled) !== off) return []
    const m = q ? hasWords(q, p.name) && fuzzy(q, p.name) : { score: 0, marks: [] }
    if (!m) return []
    const list = off ? null : toSwitch(p)
    if (!off && !list?.length) return []
    return [{ id: `plugin-${off ? "off" : "on"}:${p.id}`, name: `${say}${p.name}`, icon: p.icon, marks: m.marks.map((i) => i + say.length),
      plugin: off ? "on" as const : "off" as const, score: m.score, run: () => (off ? turnOff(p, all, disabled) : turnOn(p, list!)) }]
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(({ score: _, ...r }) => r)
}

function once(cs: Command[]) {
  const by = new Map<string, Command>()
  const rank = (c: Command) => (c.keys?.length ? 0 : c.id.startsWith("page:") ? 2 : 1)
  for (const c of cs) {
    const k = c.name.toLowerCase(), had = by.get(k)
    if (!had || rank(c) < rank(had)) by.set(k, c)
  }
  return cs.filter((c) => by.get(c.name.toLowerCase()) === c)
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const all = useCommandList()
  const plugins = usePlugins()
  const { disabled } = usePrefs()
  const { query: q, setQuery: setQ, select, picked } = useFinderQuery()
  const [setting, setSetting] = useState<"switch" | "choice" | null>(null)
  const switched = useSwitches()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- switched only triggers a recount
  const names = useMemo(() => all.filter((c) => c.nameWhenOn).map(commandName).join("\n"), [all, switched])
  const rows = useMemo((): Row[] => {
    const cs = once(available(all).filter((c) => !c.unlisted).map((c) => (c.nameWhenOn ? { ...c, name: commandName(c), words: [c.words, c.name, c.nameWhenOn].filter(Boolean).join(" ") } : c)))
    if (!q.trim()) {
      const recent = recentCommands()
      const rank = (c: Command) => { const i = recent.indexOf(c.id); return i < 0 ? recent.length : i }
      return [...cs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((c) => ({ ...c, marks: [] }))
    }
    return [...rankCommands(cs, q), ...pluginRows(plugins, disabled, q.trim())]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- names only triggers a relist
  }, [all, q, plugins, disabled, names])

  return (
    <Palette label="Command palette" placeholder="Select a command…" query={q} setQuery={setQ} select={select} items={rows} onClose={onClose}
      onPick={(c, how) => {
        if (!c) return
        picked()
        setTimeout(() => { flushSync(onClose); void (how.mod && c.place ? c.place.open() : c.plugin ? runOrSay(c.run, c.name) : runCommand(c)) }, 0)
      }}
      onSelect={(c) => setSetting(!c ? null : isSetting(c) ? "switch" : c.value ? "choice" : null)}
      section={(c) => (c.plugin === "off" ? "Plugins that are off" : c.plugin === "on" ? "Plugins that are on" : undefined)}
      empty={<NoMatches what="No command matches" query={q} />}
      hints={setting
        ? [["ArrowUp ArrowDown", "to navigate"], ["Enter", setting === "switch" ? "to switch" : "to choose"], ["Mod+Enter", "to open in Settings"], ["Escape", "to dismiss"]]
        : [["ArrowUp ArrowDown", "to navigate"], ["Enter", "to use"], ["Escape", "to dismiss"]]}
      row={(c) => {
        const Icon = commandIcon(c)
        return <>
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} /> : <span aria-hidden className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90">{marked(c.name, c.marks)}</span>
          {(isSetting(c) || c.value) && c.place && <span className="hidden max-w-[35%] shrink-0 truncate text-[13px] text-muted-foreground md:block">{c.place.name}</span>}
          {keysOf(c)[0] && <Keys keys={keysOf(c)[0]} />}
          {isSetting(c) && <SwitchMark c={c} />}
          {c.value && <ChoiceValue value={c.value} />}
        </>
      }} />
  )
}

function ChoiceValue({ value }: { value: () => string }) {
  useSwitches()
  return <span className="shrink-0 rounded-[5px] bg-muted px-1.5 text-[12px] leading-[18px] text-foreground/75" data-choice-value>{value()}</span>
}

function SwitchMark({ c }: { c: Command }) {
  useSwitches()
  const on = isOn(c)
  return (
    <span className={cn("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/[0.18]")}>
      <span className={cn("absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform", on && "translate-x-[12px]")} />
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </span>
  )
}
