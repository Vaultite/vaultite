import { useEffect, useMemo, useState } from "react"
import { Command as CommandIcon, Keyboard, Plus, RotateCcw, X } from "lucide-react"
import { canonical, isCustom, isSeeded, keyCaps, keyHint, keysOf, sameKeys, setHotkeys, shortcutOf, useCommandList, useKnownCommands } from "@/core/commands"
import { desktop } from "@/core/desktop"
import { isMac } from "@/core/platform"
import { commandIcon } from "@/core/pages"
import { pluginById } from "@/core/plugins"
import { FilterField, Segmented, SheetHead } from "@/components/kit"
import { capitalize, cn, plural } from "@/lib/utils"

// Shortcuts a browser keeps for itself (a page never sees them); the desktop app has them.
const BROWSER = ["Mod+N", "Mod+T", "Mod+W", "Mod+Q", "Mod+Shift+N", "Mod+Shift+T", "Mod+Shift+W", "Ctrl+Tab", "Ctrl+Shift+Tab",
  ...(isMac ? [] : ["Ctrl+PageUp", "Ctrl+PageDown"])]

type Known = ReturnType<typeof useKnownCommands>[number]

const AREAS: Record<string, string> = {
  editor: "Editing", list: "Editing", tab: "Tabs and panes", tabs: "Tabs and panes", pane: "Tabs and panes", split: "Tabs and panes",
  sidebar: "Tabs and panes", workspace: "Tabs and panes", nav: "Tabs and panes", newtab: "Tabs and panes", page: "Tabs and panes",
  switcher: "Tabs and panes", focus: "Tabs and panes", area: "Tabs and panes", file: "Files", vault: "Files", web: "Browser",
  theme: "Appearance", scheme: "Appearance", font: "Appearance", density: "Appearance", layouts: "Appearance", bundles: "Appearance",
  sidebars: "Appearance", "status-bar": "Appearance", icon: "Appearance", "plugin-settings": "Settings",
}
const SETTINGS = "Settings"
const areaOf = (c: Known) => {
  if (c.where) return SETTINGS
  const head = c.id.split(":")[0]
  return pluginById(head)?.name ?? AREAS[head] ?? "General"
}

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "\\"],
  ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "/"],
]
const MODS = (isMac ? ["Mod", "Shift", "Alt", "Ctrl"] : ["Mod", "Shift", "Alt"]) as readonly string[]
const combo = (mods: string[], key: string) => [...MODS.filter((m) => mods.includes(m)), key].join("+")
const ORDER = isMac ? ["Mod", "Ctrl", "Alt", "Shift"] : ["Mod", "Alt", "Shift"], CAPS = keyCaps([...ORDER, "A"].join("+"))
const glyph = (mod: string) => CAPS[ORDER.indexOf(mod)] ?? mod
const heldCaps = (held: string) => held.split("+").filter(Boolean).map(glyph).join(isMac ? "" : "+")

const iconBtn = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

function Caps({ keys, onRemove }: { keys: string; onRemove: () => void }) {
  return (
    <span data-hotkey-keys={keys} className="group/key flex items-center gap-0.5 rounded-[6px] border-[0.5px] border-border bg-card py-0.5 pr-0.5 pl-1.5 text-[12px] shadow-[0_1px_0_var(--border)]">
      {keyCaps(keys).map((k, i) => <kbd key={i} className="font-keys">{k}</kbd>)}
      <button type="button" aria-label={`Remove ${keys}`} data-tip="Remove" onClick={onRemove}
        className="ml-0.5 grid size-4 cursor-pointer place-items-center rounded-[3px] text-muted-foreground opacity-40 group-hover/key:opacity-100 hover:bg-foreground/[0.1]">
        <X className="size-3" strokeWidth={2.5} />
      </button>
    </span>
  )
}

type Recording = { id: string } | { id: string; keys: string; others: Known[] }
const FIND = "\0find"

export function HotkeysSheet() {
  const known = useKnownCommands()
  useCommandList()
  const [query, setQuery] = useState("")
  const [show, setShow] = useState<"all" | "keys" | "changed">("all")
  const [mods, setMods] = useState<string[]>(["Mod"])
  const [onKey, setOnKey] = useState<string | null>(null)
  const [rec, setRec] = useState<Recording | null>(null)
  const [held, setHeld] = useState("")

  const holders = (k: string, id?: string) => known.filter((c) => c.id !== id && keysOf(c).some((x) => sameKeys(x, k)))
  const add = (id: string, k: string) => { const c = known.find((x) => x.id === id); const now = c ? keysOf(c) : []; if (!now.some((x) => sameKeys(x, k))) setHotkeys(id, [...now, k]) }
  const take = (id: string, k: string, from: Known[]) => { for (const o of from) setHotkeys(o.id, keysOf(o).filter((x) => !sameKeys(x, k))); add(id, k) }

  const listening = rec && !("keys" in rec)
  useEffect(() => {
    if (!listening) return
    const id = rec.id
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === "Escape") return setRec(null)
      setHeld([isMac ? e.metaKey && "Mod" : e.ctrlKey && "Mod", isMac && e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean).join("+"))
      const k = shortcutOf(e)
      if (!k || !(/^(Mod|Ctrl|Alt)\+/.test(k) || /^F\d+$/.test(k.split("+").pop()!))) return
      setHeld("")
      if (id === FIND) { setOnKey(k); setQuery(""); return setRec(null) }
      const others = holders(k, id)
      if (others.length) return setRec({ id, keys: k, others })
      add(id, k)
      setRec(null)
    }
    const up = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) setHeld("") }
    const cancel = () => setRec(null)
    addEventListener("keydown", down, true)
    addEventListener("keyup", up, true)
    addEventListener("blur", cancel)
    return () => { removeEventListener("keydown", down, true); removeEventListener("keyup", up, true); removeEventListener("blur", cancel); setHeld("") }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebinds only when recording starts or the commands change
  }, [listening, rec?.id, known])

  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const rows = known.filter((c) => {
      const keys = keysOf(c)
      if (onKey && !keys.some((k) => sameKeys(k, onKey))) return false
      if (show === "keys" && !keys.length) return false
      if (show === "changed" && !isCustom(c.id)) return false
      return words.every((w) => `${c.name} ${c.nameWhenOn ?? ""} ${c.where ?? ""} ${c.id} ${areaOf(c)} ${keys.map(keyHint).join(" ")}`.toLowerCase().includes(w))
    })
    const by = new Map<string, Known[]>()
    for (const c of rows) by.set(areaOf(c), [...(by.get(areaOf(c)) ?? []), c])
    return [...by.entries()].map(([area, list]) => [area, list.sort((a, b) => a.name.localeCompare(b.name))] as const)
      .sort(([a], [b]) => (a === SETTINGS ? 1 : b === SETTINGS ? -1 : a === "General" ? -1 : b === "General" ? 1 : a.localeCompare(b)))
  }, [known, query, show, onKey])
  const count = groups.reduce((n, [, l]) => n + l.length, 0)
  const changed = known.filter((c) => isCustom(c.id)).length

  return (
    <>
      <SheetHead icon={Keyboard} tint="var(--gray)" title="Hotkeys" sub="Every command's keys, saved in the vault (.vaultite/hotkeys.json)" />
      <KeyMap known={known} mods={mods} setMods={setMods} picked={onKey} pick={(k) => { setOnKey(k && onKey && sameKeys(k, onKey) ? null : k); setQuery("") }} />
      <div className="sticky top-0 z-10 -mx-1 mb-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur" data-hotkeys-bar>
        {onKey ? (
          <span className="flex h-7.5 items-center gap-1.5 rounded-[8px] bg-primary/10 pr-1 pl-2.5 text-[13px] text-primary" data-hotkeys-on-key={onKey}>
            Commands on <kbd className="font-keys font-semibold">{keyHint(onKey)}</kbd>
            <button type="button" aria-label="Show every command" data-tip="Show every command" onClick={() => setOnKey(null)} className="grid size-5 cursor-pointer place-items-center rounded-[4px] hover:bg-primary/15">
              <X className="size-3.5" strokeWidth={2.25} />
            </button>
          </span>
        ) : <FilterField value={query} onChange={setQuery} placeholder="Filter commands" className="min-w-40" autoFocus />}
        <button type="button" onClick={() => setRec(rec?.id === FIND ? null : { id: FIND })} data-hotkeys-find aria-pressed={rec?.id === FIND}
          className={cn("flex h-7.5 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border-[0.5px] border-border bg-card px-2.5 text-[13px] hover:bg-foreground/[0.04]",
            rec?.id === FIND && "text-primary ring-1 ring-primary")}>
          <CommandIcon className="size-3.5" strokeWidth={2} />
          {rec?.id === FIND ? (held ? `${heldCaps(held)}…` : "Press keys…") : "Find by keys"}
        </button>
        <Segmented<"all" | "keys" | "changed"> label="Which commands" value={show} onChange={setShow} className="shrink-0"
          options={[{ value: "all", label: "All" }, { value: "keys", label: "With keys" }, { value: "changed", label: changed ? `Changed (${changed})` : "Changed" }]} />
      </div>
      <div data-hotkeys>
        {groups.map(([area, list]) => (
          <section key={area} aria-label={area} data-hotkeys-area={area} className="mt-4 first:mt-1">
            <h3 className="mb-0.5 flex items-baseline gap-2 px-0.5 text-[12px] font-semibold text-muted-foreground">
              {area}<span className="font-normal tabular-nums">{list.length}</span>
            </h3>
            <div className="hairline">
              {list.map((c) => <Row key={c.id} c={c} rec={rec?.id === c.id ? rec : null} held={held} holders={holders}
                record={() => setRec(rec?.id === c.id ? null : { id: c.id })} cancel={() => setRec(null)}
                replace={(k, from) => { take(c.id, k, from); setRec(null) }} both={(k) => { add(c.id, k); setRec(null) }} />)}
            </div>
          </section>
        ))}
        {!count && <div className="py-3 text-[13px] text-muted-foreground">{onKey ? `Nothing is on ${keyHint(onKey)} yet: pick a command's + to give it these keys.` : query.trim() ? `No command matches “${query.trim()}”` : "None yet."}</div>}
      </div>
    </>
  )
}

function Row({ c, rec, held, holders, record, cancel, replace, both }: {
  c: Known; rec: Recording | null; held: string; holders: (k: string, id?: string) => Known[]
  record: () => void; cancel: () => void; replace: (k: string, from: Known[]) => void; both: (k: string) => void
}) {
  const keys = keysOf(c)
  const Icon = commandIcon(c) ?? pluginById(c.id.split(":")[0])?.icon ?? null
  const notes = keys.flatMap((k) => {
    const o = holders(k, c.id)
    return [
      ...(o.length ? [`${keyHint(k)} is also ${o.map((x) => x.name).join(", ")}`] : []),
      ...(!desktop && BROWSER.some((b) => sameKeys(b, k)) ? [`${keyHint(k)} is kept by the browser (the desktop app has it)`] : []),
    ]
  })
  const asking = rec && "keys" in rec ? rec : null
  return (
    <div data-hotkey={c.id} className="group/row flex min-h-10 flex-col justify-center py-1">
      <div className="flex items-center gap-2.5">
        <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">{Icon && <Icon className="size-4" strokeWidth={2} />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px]">{c.name}{c.where && <span className="text-muted-foreground"> · {c.where}</span>}
            {isSeeded(c.id) && <span data-hotkey-seeded className="text-muted-foreground"> · Obsidian's keys</span>}</div>
          {notes.map((n) => <div key={n} data-hotkey-conflict className="truncate text-[12px] text-ink-(--red)">{n}</div>)}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {keys.map((k) => <Caps key={k} keys={k} onRemove={() => setHotkeys(c.id, keys.filter((x) => x !== k))} />)}
          {rec && !asking && (
            <span data-recording className="rounded-[6px] px-2 py-0.5 text-[12px] text-primary ring-1 ring-primary">
              {held ? <kbd className="font-keys">{heldCaps(held)}…</kbd> : "Press keys…"}
            </span>
          )}
          {isCustom(c.id) && (
            <button type="button" className={cn(iconBtn, "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100")} aria-label="Restore default" data-tip="Restore default" onClick={() => setHotkeys(c.id, null)} data-hotkey-reset>
              <RotateCcw className="size-3.5" strokeWidth={2} />
            </button>
          )}
          <button type="button" className={cn(iconBtn, rec ? "text-primary" : !keys.length ? "" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100")}
            aria-label={`Add a hotkey to ${c.name}`} data-tip={rec ? "Cancel" : "Add a hotkey"} onClick={record}>
            {rec ? <X className="size-4" strokeWidth={2} /> : <Plus className="size-4" strokeWidth={2} />}
          </button>
        </div>
      </div>
      {asking && (
        <div className="mt-1 mb-1 ml-7.5 flex flex-wrap items-center gap-2 rounded-[8px] bg-foreground/[0.04] px-2.5 py-1.5 text-[13px]" data-hotkey-taken={asking.keys}>
          <span className="min-w-0 flex-1"><kbd className="font-keys font-semibold">{keyHint(asking.keys)}</kbd> is {asking.others.map((o) => o.name).join(", ")}</span>
          <button type="button" onClick={() => replace(asking.keys, asking.others)} data-hotkey-replace className="h-7 cursor-pointer rounded-[6px] bg-primary px-2.5 text-[13px] font-medium text-primary-foreground">Replace</button>
          <button type="button" onClick={() => both(asking.keys)} className="h-7 cursor-pointer rounded-[6px] border-[0.5px] border-border bg-card px-2.5 text-[13px] hover:bg-foreground/[0.05]">Keep both</button>
          <button type="button" onClick={cancel} className="h-7 cursor-pointer rounded-[6px] px-2 text-[13px] text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      )}
    </div>
  )
}

function KeyMap({ known, mods, setMods, picked, pick }: { known: Known[]; mods: string[]; setMods: (m: string[]) => void; picked: string | null; pick: (k: string | null) => void }) {
  const on = useMemo(() => {
    const keyOf = new Map(ROWS.flat().map((r) => [canonical(combo(mods, r)).toLowerCase(), r]))
    const m = new Map<string, Known[]>()
    for (const c of known) for (const k of keysOf(c)) {
      const r = keyOf.get(canonical(k).toLowerCase())
      if (r) m.set(r, [...(m.get(r) ?? []), c])
    }
    return m
  }, [known, mods])
  const used = on.size, free = ROWS.flat().length - used
  return (
    <div className="mb-2 rounded-[12px] bg-foreground/[0.03] p-3 max-md:hidden" data-hotkeys-map>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {MODS.map((m) => {
          const held = mods.includes(m)
          return (
            <button key={m} type="button" aria-pressed={held} data-hotkeys-mod={m} onClick={() => setMods(held ? mods.filter((x) => x !== m) : [...mods, m])}
              className={cn("h-7 min-w-9 cursor-pointer rounded-[6px] border-[0.5px] px-2 font-keys text-[13px] transition-colors",
                held ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {glyph(m)}
            </button>
          )
        })}
        <span className="ml-1 flex-1 text-[12px] text-muted-foreground">
          {mods.length ? `${capitalize(plural(used, "key"))} in use with ${mods.map(glyph).join(isMac ? "" : "+")}, ${free} free` : "Pick a modifier to see its keys"}
        </span>
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-[3px] bg-primary/25" />In use</span>
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-[3px] bg-[var(--red)]/30" />Two commands</span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {ROWS.map((row, i) => (
          <div key={i} className="flex gap-1" style={{ paddingLeft: `${i * 0.6}rem` }}>
            {row.map((k) => {
              const cs = on.get(k) ?? [], at = combo(mods, k), lit = !!picked && sameKeys(picked, at)
              return (
                <button key={k} type="button" disabled={!mods.length} onClick={() => pick(at)} data-hotkeys-key={k} data-used={cs.length || undefined}
                  data-tip={cs.length ? `${keyHint(at)}: ${cs.map((c) => c.name).join(", ")}` : `${keyHint(at)}: free`}
                  className={cn("relative flex h-9 min-w-0 flex-1 cursor-pointer flex-col items-start justify-between rounded-[6px] border-[0.5px] px-1.5 py-1 text-left shadow-[0_1px_0_var(--border)] transition-colors disabled:cursor-default",
                    cs.length > 1 ? "border-[var(--red)]/40 bg-[var(--red)]/15" : cs.length ? "border-primary/30 bg-primary/12 hover:bg-primary/20" : "border-border bg-card hover:bg-foreground/[0.04]",
                    lit && "ring-2 ring-primary")}>
                  <span className={cn("font-keys text-[11px] leading-none", cs.length ? "font-semibold" : "text-muted-foreground")}>{k}</span>
                  {!!cs.length && <span className="w-full truncate text-[9px] leading-[11px] text-muted-foreground">{cs[0].name}</span>}
                </button>
              )
            })}
            {Array.from({ length: 12 - row.length }, (_, j) => <span key={j} className="flex-1" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
