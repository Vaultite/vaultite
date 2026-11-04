// Properties pinned to files' headers: a key whose values are a short list, drawn as a chip (like Provenance's) for the
// kinds of file asked, set up in its settings sheet.
import { useState } from "react"
import { Plus } from "lucide-react"
import {
  CHIP_TINTS, ChipValuesEditor, chipValues, get, getStore, Group, isHidden, notify, notifyError, openPluginSettings, openView, optimistic, patch, plural,
  PropertyChip, Section, SettingRow, Switch, useLive, useStore, type ChipValue, type FileHead, type Store,
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
/** Shown at once (the store), then saved; a failure brings the saved ones back and says so. */
const save = (list: Chip[]) => optimistic((s) => ({ ...s, propertyChips: list.map(saved) }),
  () => patch("config/plugin/properties", { chips: list.length ? list.map(saved) : null }), "Couldn't save it").then(() => {}, () => {})

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
  const all = store.properties ?? []
  return (
    <div className="space-y-5">
      <Group>
        <SettingRow label="Every property" sub="Its files, and renamed or retyped everywhere at once"
          value={all.length ? plural(all.length, "property", "properties") : ""} onClick={() => openView("properties")} data-properties-all />
      </Group>
      <Section title="In files' headers">
        <p className="mb-1.5 px-1 text-[12px] leading-[16px] text-muted-foreground">A property shown as a chip at the top of each file, set from there, its values each with an icon and a colour.</p>
        <div className="space-y-2">
          {list.map((c, i) => (
            <div key={c.key} data-chip-settings={c.key} className="space-y-2">
              <div className="px-1 pt-1 text-[13px] font-semibold">{c.key}</div>
              <Group><ChipValuesEditor values={c.values} onChange={(values) => put(i, { values })} label={`${c.key}'s values`} /></Group>
              <Group>
                <Kinds c={c} set={(types) => put(i, { types })} />
                <SettingRow label="When a file doesn't have it" sub="A dashed icon to set it from">
                  <Switch on={c.showUnset} onChange={(showUnset) => put(i, { showUnset })} label="When a file doesn't have it" />
                </SettingRow>
                <SettingRow label="In the status bar">
                  <Switch on={c.statusBar} onChange={(statusBar) => put(i, { statusBar })} label="In the status bar" />
                </SettingRow>
                <SettingRow label={<span className="text-ink-(--red)">Remove from files' headers</span>} onClick={() => unpin(c.key)} chevron={null} data-chip-unpin={c.key} />
              </Group>
            </div>
          ))}
          <AddChip pinned={list.map((c) => c.key)} />
        </div>
      </Section>
    </div>
  )
}

/** The vault's properties that make good chips (properties/chippable: a short list of words each), most used first:
 *  one tap shows it in files' headers. */
function AddChip({ pinned }: { pinned: string[] }) {
  const [more, setMore] = useState(false)
  const { data } = useLive<{ key: string; count: number; values: number }[]>("properties/chippable")
  if (!data) return null
  const can = data.filter((p) => !pinned.includes(p.key))
  if (!can.length) {
    return pinned.length ? null : <p className="px-1 text-[13px] leading-[18px] text-muted-foreground" data-chips-empty>None yet: no property in the vault has a short list of values (status, priority…).</p>
  }
  const shown = more ? can : can.slice(0, 5)
  const add = (p: (typeof can)[number]) => { pin({ key: p.key, count: p.count, type: "text", types: {} }).catch((e) => notifyError(e, "Couldn't add it")) }
  return (
    <Group>
      <div className="pt-2 pb-1 text-[12px] font-medium text-muted-foreground" data-chips-add>{pinned.length ? "Add another" : "Add one"}</div>
      {shown.map((p) => (
        <SettingRow key={p.key} data-chip-add={p.key} onClick={() => add(p)} chevron={Plus} label={p.key} sub={`${plural(p.values, "value")}, in ${plural(p.count, "file")}`} />
      ))}
      {can.length > shown.length && <SettingRow label={<span className="text-primary">Show all {can.length}</span>} onClick={() => setMore(true)} chevron={null} />}
    </Group>
  )
}
