// Hotkeys: a sheet with every command and its keys, saved in hotkeys.json one command at a time
// ([] = no keys).
import { useEffect, useMemo, useState } from "react"
import { Keyboard, Plus, RotateCcw, X } from "lucide-react"
import { isCustom, keyCaps, keyHint, keysOf, sameKeys, setHotkeys, shortcutOf, useCommandList, useKnownCommands } from "@/core/commands"
import { desktop } from "@/core/desktop"
import { isMac } from "@/core/platform"
import { openDetail } from "@/core/nav"
import { FilterField, Panel, SettingRow, SheetHead } from "@/components/kit"
import { cn } from "@/lib/utils"

// Shortcuts a browser keeps for itself (a page never sees them); the desktop app has them.
const BROWSER = ["Mod+N", "Mod+T", "Mod+W", "Mod+Q", "Mod+Shift+N", "Mod+Shift+T", "Mod+Shift+W", "Ctrl+Tab", "Ctrl+Shift+Tab",
  ...(isMac ? [] : ["Ctrl+PageUp", "Ctrl+PageDown"])]

const icon = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

function Caps({ keys, onRemove }: { keys: string; onRemove: () => void }) {
  return (
    <span className="group/key flex items-center gap-0.5 rounded-[6px] border-[0.5px] border-border bg-foreground/[0.06] py-0.5 pr-0.5 pl-1.5 text-[12px] text-muted-foreground">
      {keyCaps(keys).map((k, i) => <kbd key={i} className="font-sans">{k}</kbd>)}
      <button type="button" aria-label={`Remove ${keys}`} data-tip="Remove" onClick={onRemove}
        className="ml-0.5 grid size-4 cursor-pointer place-items-center rounded-[3px] opacity-50 hover:bg-foreground/[0.1] hover:opacity-100">
        <X className="size-3" strokeWidth={2.5} />
      </button>
    </span>
  )
}

/** Settings' Hotkeys: one row saying how many commands have keys of their own; it opens the sheet. Desktop only (a
 *  phone has no keyboard shortcuts). */
export function Hotkeys() {
  const known = useKnownCommands()
  useCommandList() // redraw when hotkeys.json changes
  const changed = known.filter((c) => isCustom(c.id)).length
  return (
    <Panel title="Hotkeys" className="max-md:hidden">
      <SettingRow label="Keyboard shortcuts" sub={`Every command's keys (${known.length}), saved in .vaultite/hotkeys.json`}
        value={changed ? `${changed} changed` : "Default"} onClick={() => openDetail("hotkeys")} data-hotkeys-open />
    </Panel>
  )
}

/** The sheet: every command with its keys, a filter on top. */
export function HotkeysSheet() {
  const known = useKnownCommands()
  useCommandList() // redraw when hotkeys.json changes
  const [query, setQuery] = useState("")
  const [recording, setRecording] = useState<string | null>(null)

  // Recording: the next combination with ⌘, ⌃ or ⌥ (or a function key) is the new hotkey; Esc cancels. Caught before
  // anything else sees it, so it runs nothing.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === "Escape") return setRecording(null)
      const k = shortcutOf(e)
      if (!k || !(/^(Mod|Ctrl|Alt)\+/.test(k) || /^F\d+$/.test(k.split("+").pop()!))) return
      const c = known.find((x) => x.id === recording)
      const now = c ? keysOf(c) : []
      if (!now.some((x) => sameKeys(x, k))) setHotkeys(recording, [...now, k])
      setRecording(null)
    }
    const cancel = () => setRecording(null)
    addEventListener("keydown", onKey, true)
    addEventListener("blur", cancel)
    return () => { removeEventListener("keydown", onKey, true); removeEventListener("blur", cancel) }
  }, [recording, known])

  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return [...known].sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => words.every((w) => `${c.name} ${c.id} ${keysOf(c).join(" ")}`.toLowerCase().includes(w)))
  }, [known, query])

  // Who else has these keys.
  const others = (id: string, k: string) => known.filter((c) => c.id !== id && keysOf(c).some((x) => sameKeys(x, k))).map((c) => c.name)

  return (
    <>
      <SheetHead icon={Keyboard} tint="var(--primary)" kicker="Settings" title="Hotkeys"
        sub="Every command's keys, saved in the vault (.vaultite/hotkeys.json). Press + and then the new keys; Esc cancels." />
      <FilterField value={query} onChange={setQuery} placeholder="Filter commands" className="mb-1" />
      <div className="hairline" data-hotkeys>
        {rows.map((c) => {
          const keys = keysOf(c)
          const notes = keys.flatMap((k) => {
            const o = others(c.id, k)
            return [
              ...(o.length ? [`${keyHint(k)} is also ${o.join(", ")}`] : []),
              ...(!desktop && BROWSER.some((b) => sameKeys(b, k)) ? [`${keyHint(k)} is kept by the browser (the desktop app has it)`] : []),
            ]
          })
          return (
            <div key={c.id} data-hotkey={c.id} className="flex min-h-10 items-center gap-3 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{c.name}</div>
                {notes.map((n) => <div key={n} data-hotkey-conflict className="truncate text-[12px] text-[var(--red)]">{n}</div>)}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                {keys.map((k) => <Caps key={k} keys={k} onRemove={() => setHotkeys(c.id, keys.filter((x) => x !== k))} />)}
                {!keys.length && recording !== c.id && <span className="text-[12px] text-tertiary">None</span>}
                {recording === c.id && (
                  <span data-recording className="rounded-[6px] px-2 py-0.5 text-[12px] text-primary ring-1 ring-primary">Press keys…</span>
                )}
                {isCustom(c.id) && (
                  <button type="button" className={icon} aria-label="Restore default" data-tip="Restore default" onClick={() => setHotkeys(c.id, null)}>
                    <RotateCcw className="size-3.5" strokeWidth={2} />
                  </button>
                )}
                <button type="button" className={cn(icon, recording === c.id && "text-primary")} aria-label={`Add a hotkey to ${c.name}`} data-tip="Add a hotkey"
                  onClick={() => setRecording(recording === c.id ? null : c.id)}>
                  <Plus className="size-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          )
        })}
        {!rows.length && <div className="py-3 text-[13px] text-muted-foreground">No command matches.</div>}
      </div>
    </>
  )
}
