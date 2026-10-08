// Properties pinned to files' headers: a key whose values are a short list, drawn as a chip (like Provenance's) for the
// kinds of file asked, set up in its settings sheet.
import { useState } from "react"
import {
  CHIP_TINTS, ChipValuesEditor, chipValues, get, getStore, Group, isHidden, notify, notifyError, openPluginSettings, patch, PropertyChip, Section, SettingRow,
  Switch, useStore, type ChipValue, type FileHead, type Store,
} from "@vaultite"
import type { PropChip, PropSummary } from "./types"

/** A pinned property as the app uses it. */
export type Chip = { key: string; values: ChipValue[]; types: string[]; statusBar: boolean; showUnset: boolean }

/** Its settings' chips, read leniently. */
export function chipsOf(store: Store | null): Chip[] {
  return (store?.propertyChips ?? []).map((c) => ({
    key: c.key.trim(),
    values: chipValues(c.values),
    types: Array.isArray(c.types) ? c.types.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim().toLowerCase()) : [],
    statusBar: c.status_bar === true,
    showUnset: c.show_unset !== false,
  }))
}

/** As its settings keep it: only what isn't the default. */
const saved = (c: Chip): PropChip => ({
  key: c.key, values: c.values,
  ...(c.types.length ? { types: c.types } : {}), ...(c.statusBar ? { status_bar: true } : {}), ...(c.showUnset ? {} : { show_unset: false }),
})
const save = (list: Chip[]) => patch("config/plugin/properties", { chips: list.length ? list.map(saved) : null }).catch((e) => notifyError(e, "Couldn't save it"))

/** Asked of this file: a Markdown file in the vault, of one of its kinds (a plain note is `note`) when it has some. */
const asks = (c: Chip, f: FileHead) => /\.md$/i.test(f.path) && !isHidden(f.path) && (!c.types.length || c.types.includes(f.type ?? "note"))

/** The pinned properties for this file, in order. */
export function Chips({ file, place }: { file: FileHead; place: "bar" | "line" | "status" }) {
  const { store } = useStore()
  const list = chipsOf(store).filter((c) => asks(c, file) && (place !== "status" || c.statusBar))
  if (!list.length) return null
  return <>{list.map((c) => <PropertyChip key={c.key} file={file} prop={c.key} values={c.values} place={place} showUnset={c.showUnset} unset="None" />)}</>
}

/** Whether a property can be pinned: one whose values are words (a checkbox, a number or a list would become text). */
export const pinnable = (p: PropSummary) => p.key !== "origin" && (p.type === "text" || p.type === "empty")
export const isPinned = (key: string) => chipsOf(getStore()).some((c) => c.key === key)

/** Pin a property: its values are the vault's (the 12 most used), each with a colour of its own. */
export async function pin(p: PropSummary) {
  const list = chipsOf(getStore())
  if (list.some((c) => c.key === p.key)) return
  let rows: { value: unknown }[] = []
  try { rows = await get<{ path: string; value: unknown }[]>(`properties?key=${encodeURIComponent(p.key)}`) } catch { /* none then */ }
  const counts = new Map<string, number>()
  for (const r of rows) {
    const v = typeof r.value === "string" ? r.value.trim() : ""
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const tints = CHIP_TINTS.filter((t) => t !== "gray")
  const values = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value], i): ChipValue => ({ value, icon: "circle", tint: tints[i % tints.length] }))
  await save([...list, { key: p.key, values, types: [], statusBar: false, showUnset: true }])
  notify(`${p.key} is in files' headers now`, { action: { label: "Set it up", run: () => openPluginSettings("properties") } })
}

export const unpin = (key: string) => save(chipsOf(getStore()).filter((c) => c.key !== key))

// ---------- its settings sheet

const field = "h-8 min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary md:h-7 md:text-[14px]"

/** The kinds a chip is asked of, as words ("note, project"); empty: every file. */
function Kinds({ c, set }: { c: Chip; set: (types: string[]) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = c.types.join(", ")
  return (
    <SettingRow data-setting="only" label="Only on" sub="Kinds of file (note, project, person…); every file when empty">
      <input value={typed ?? text} placeholder="Every file" aria-label="Only on" spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => { if (typed !== null && typed !== text) set(typed.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)); setTyped(null) }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { e.stopPropagation(); setTyped(null) } }}
        className={`${field} w-40`} />
    </SettingRow>
  )
}

export function ChipsSettings({ store }: { store: Store }) {
  const list = chipsOf(store)
  const put = (i: number, c: Partial<Chip>) => save(list.map((x, j) => (j === i ? { ...x, ...c } : x)))
  if (!list.length) {
    return (
      <Section title="In files' headers">
        <p className="px-1 text-[13px] leading-[18px] text-muted-foreground" data-chips-empty>
          None yet. Right-click a property in All properties (status, priority…), then Show in files' headers: it becomes a chip next to the
          file's origin, its values each with an icon and a colour.
        </p>
      </Section>
    )
  }
  return (
    <>
      {list.map((c, i) => (
        <Section key={c.key} title={c.key}>
          <div data-chip-settings={c.key} className="space-y-2">
            <Group><ChipValuesEditor values={c.values} onChange={(values) => put(i, { values })} label={`${c.key}'s values`} /></Group>
            <Group>
              <Kinds c={c} set={(types) => put(i, { types })} />
              <SettingRow label="When a file doesn't have it" sub="A dashed icon to set it from">
                <Switch on={c.showUnset} onChange={(showUnset) => put(i, { showUnset })} label="When a file doesn't have it" />
              </SettingRow>
              <SettingRow label="In the status bar">
                <Switch on={c.statusBar} onChange={(statusBar) => put(i, { statusBar })} label="In the status bar" />
              </SettingRow>
              <SettingRow label={<span className="text-[var(--red)]">Remove from files' headers</span>} onClick={() => unpin(c.key)} chevron={null} data-chip-unpin={c.key} />
            </Group>
          </div>
        </Section>
      ))}
    </>
  )
}
