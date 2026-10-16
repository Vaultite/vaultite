// The command palette (⌘P): commands offered now, fuzzy by name, the used last first; a setting shows its switch. A
// plugin that's off whose name is typed is offered to turn on ("turn off" and a name, to turn off).
import { useMemo, useState } from "react"
import { available, commandName, isOn, isSetting, keysOf, recentCommands, runCommand, runOrSay, useCommandList, type Command } from "@/core/commands"
import { useSwitches } from "@/core/switches"
import { commandIcon } from "@/core/pages"
import { isEnabled, names, pluginById, setSwitch, switchedOn, usePlugins, type Plugin } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { notify } from "@/core/notify"
import { fuzzy, hasWords } from "@/core/fuzzy"
import { Keys, Marked, Palette } from "@/components/Palette"
import { cn } from "@/lib/utils"

/** `plugin`: a row that switches a plugin, which is now on or off. */
type Row = Command & { marks: number[]; plugin?: "on" | "off" }

const TURN_ON = "Turn on ", TURN_OFF = "Turn off "
/** Plugins' names as a list: "Code stats, GitHub, and Reddit". */
const listed = (ids: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(ids.map((i) => names([i])))

/** What turning `p` on switches: it, and what it needs that's switched off (all the way down). A vault plugin turned on
 *  here is allowed here, as its switch does. */
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

/** Turn them on, saying so with Undo (which turns them off again). */
function turnOn(p: Plugin, list: Plugin[]) {
  for (const x of list) setSwitch(x, true)
  const also = list.filter((x) => x !== p).map((x) => x.id)
  notify(`${p.name} is on${also.length ? `, and ${listed(also)}` : ""}`, { action: { label: "Undo", run: () => { for (const x of list) setSwitch(x, false) } } })
}

/** Turn one off, saying so (and what goes off with it: what needs it) with Undo. */
function turnOff(p: Plugin, all: Plugin[], disabled: string[]) {
  const gone = all.filter((x) => x !== p && isEnabled(x.id, disabled) && needs(x, p.id)).map((x) => x.id)
  setSwitch(p, false)
  notify(`${p.name} is off${gone.length ? `, and ${listed(gone)} with it` : ""}`, { action: { label: "Undo", run: () => setSwitch(p, true) } })
}
/** `x` requires `id`, all the way down. */
const needs = (x: Plugin, id: string, seen: string[] = []): boolean =>
  !seen.includes(x.id) && (x.requires ?? []).some((r) => r === id || (!!pluginById(r) && needs(pluginById(r)!, id, [...seen, x.id])))

/** Plugins to switch whose names match what's typed: off ones to turn on, on ones to turn off only after "turn off" or
 *  "disable" (a plain name mustn't offer that next to its commands). "Turn on" alone lists every one that's off. */
function pluginRows(all: Plugin[], disabled: string[], typed: string): Row[] {
  const verb = /^(turn on|enable|turn off|disable)\b\s*/i.exec(typed)
  const off = !!verb && /off|disable/i.test(verb[1])
  const q = verb ? typed.slice(verb[0].length) : typed
  if (!verb && q.length < 2) return []
  const say = off ? TURN_OFF : TURN_ON
  return all.flatMap((p) => {
    // (one switched in a Settings section is a switch there, as it's named: Vim keys)
    if (p.alwaysOn || p.switchIn || isEnabled(p.id, disabled) !== off) return []
    // Only where the name has the words as typed (a fuzzy hit across a long name would offer every plugin).
    const m = q ? hasWords(q, p.name) && fuzzy(q, p.name) : { score: 0, marks: [] }
    if (!m) return []
    const list = off ? null : toSwitch(p)
    if (!off && !list?.length) return []
    return [{ id: `plugin-${off ? "off" : "on"}:${p.id}`, name: `${say}${p.name}`, icon: p.icon, marks: m.marks.map((i) => i + say.length),
      plugin: off ? "on" as const : "off" as const, score: m.score, run: () => (off ? turnOff(p, all, disabled) : turnOn(p, list!)) }]
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(({ score: _, ...r }) => r)
}

/** One row per name: a plugin's command and a pinned page's "Open …" can say the same (Open activity), and so can two
 *  plugins. The one with keys wins, then one that isn't a page's. */
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
  const [q, setQ] = useState("")
  const [sel, setSel] = useState<Row | null>(null)
  const switched = useSwitches()
  const rows = useMemo((): Row[] => {
    // Named as they are now ("Hide left sidebar"), found by either name.
    const cs = once(available(all).map((c) => (c.nameWhenOn ? { ...c, name: commandName(c), words: [c.words, c.name, c.nameWhenOn].filter(Boolean).join(" ") } : c)))
    if (!q.trim()) {
      const recent = recentCommands()
      const rank = (c: Command) => { const i = recent.indexOf(c.id); return i < 0 ? recent.length : i }
      return [...cs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((c) => ({ ...c, marks: [] }))
    }
    const typed = q.trim().toLowerCase().split(/\s+/)
    const byWords = (c: Command) => { const ws = `${c.name} ${c.words}`.toLowerCase().split(/\s+/); return typed.every((t) => ws.some((w) => w.startsWith(t))) }
    // A match by its other words comes after every match by name.
    const found: Row[] = cs.flatMap((c) => { const m = fuzzy(q.trim(), c.name); return m ? [{ ...c, marks: m.marks, score: m.score }] : c.words && byWords(c) ? [{ ...c, marks: [], score: -Infinity }] : [] })
      .sort((a, b) => b.score - a.score).map(({ score: _, ...c }) => c)
    return [...found, ...pluginRows(plugins, disabled, q.trim())]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, plugins, disabled, switched])
  const setting = !!sel && isSetting(sel)

  return (
    <Palette label="Command palette" placeholder="Select a command…" query={q} setQuery={setQ} items={rows} onClose={onClose}
      // Switching a plugin isn't a command: it's left out of the recent ones.
      onPick={(c, how) => {
        if (!c) return
        onClose()
        setTimeout(() => (how.mod && c.place ? c.place.open() : c.plugin ? runOrSay(c.run, c.name) : runCommand(c)), 0)
      }}
      onSelect={setSel}
      section={(c) => (c.plugin === "off" ? "Plugins that are off" : c.plugin === "on" ? "Plugins that are on" : undefined)}
      empty={<p className="px-3 py-6 text-center text-[15px] text-muted-foreground">No command matches "{q.trim()}".</p>}
      hints={setting
        ? [["ArrowUp ArrowDown", "to navigate"], ["Enter", "to switch"], ["Mod+Enter", "to open in Settings"], ["Escape", "to dismiss"]]
        : [["ArrowUp ArrowDown", "to navigate"], ["Enter", "to use"], ["Escape", "to dismiss"]]}
      row={(c) => {
        const Icon = commandIcon(c)
        return <>
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} /> : <span aria-hidden className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90"><Marked text={c.name} marks={c.marks} /></span>
          {isSetting(c) && c.place && <span className="hidden max-w-[35%] shrink-0 truncate text-[13px] text-muted-foreground md:block">{c.place.name}</span>}
          {keysOf(c)[0] && <Keys keys={keysOf(c)[0]} />}
          {isSetting(c) && <SwitchMark on={isOn(c)} />}
        </>
      }} />
  )
}

/** A setting's state at the end of its row: the switch Settings draws, small, to look at (Enter flips it). */
function SwitchMark({ on }: { on: boolean }) {
  return (
    <span className={cn("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/[0.18]")}>
      <span className={cn("absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform", on && "translate-x-[12px]")} />
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </span>
  )
}
