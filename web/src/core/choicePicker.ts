// A setting of a few values as a picker in the palette: its values, the one in use checked and shown as the selection
// moves (where `preview` can), Enter keeps one (with Undo), Esc goes back. The settings themselves: core/choices.ts.
import type { Choose } from "@/components/Chooser"
import type { Command } from "@/core/commands"
import type { SettingDecl } from "../../../core/blocks.ts"

export type ChoiceOption = { value: string; label: string }
export type ChoiceDef = {
  /** Its command; the app's are `setting:<row>`, `<row>` its Settings row (`data-settings-row`). */
  id: string
  /** What Settings calls it, the same everywhere: "Animations"; its command is "Animations…". */
  name: string
  /** What it's for, above its values (a plugin's description). */
  sub?: () => string
  /** Other words it's found by (its values' names are too). */
  words?: string
  icon?: Command["icon"]
  /** Where Settings has it: an app section ("appearance"), or a plugin's settings sheet and its key there. */
  section?: string
  plugin?: { id: string; key: string }
  /** Its values, as Settings names them. */
  options: () => ChoiceOption[]
  get: () => string
  set: (value: string) => unknown
  /** Show a value for now, saved nowhere; null goes back. Only where it's cheap and shows (the look). */
  preview?: (value: string | null) => void
  /** Offered only while this holds. */
  when?: () => boolean
}

/** The label of the value in use (its value itself when it isn't one of them). */
export const choiceLabel = (c: ChoiceDef, value = c.get()) => c.options().find((o) => o.value === value)?.label ?? value

/** The picker for `c` (Chooser's `choose`); `say` is the toast saying what was picked, with Undo. */
export function choicePicker(c: ChoiceDef, say: (text: string, undo: () => void) => void): Choose {
  const was = c.get(), sub = c.sub?.()
  return {
    title: c.name, placeholder: `${c.name}…`, heading: sub || undefined, current: was,
    items: c.options().map((o) => ({ id: o.value, label: o.label })),
    preview: c.preview && ((it) => c.preview!(it ? it.id : null)),
    onPick: (it) => {
      if (it.id === was) return
      void c.set(it.id)
      say(`${c.name}: ${choiceLabel(c, it.id)}`, () => void c.set(was))
    },
  }
}

/** A plugin's enum setting (`d`, its manifest's) as a choice, its values matched by their text (a number's too); the
 *  default again takes the key out, so the vault keeps only what was chosen. */
export function declChoice(p: { id: string; name: string; icon?: Command["icon"] }, key: string, d: SettingDecl, dflt: unknown,
  s: { get: () => Record<string, unknown>; set: (keys: Record<string, unknown>) => unknown; preview: (keys: Record<string, unknown> | null) => void }): ChoiceDef {
  const values = d.values ?? []
  const of = (id: string) => values.find((x) => String(x) === id)
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  return {
    id: `setting:${p.id}:${key}`, name: d.label, icon: p.icon, plugin: { id: p.id, key },
    sub: () => cap(d.description ?? ""), words: [p.name, d.description].filter(Boolean).join(" "),
    options: () => values.map((v) => ({ value: String(v), label: d.labels?.[String(v)] ?? cap(String(v)) })),
    get: () => { const v = s.get()[key]; return String(values.some((x) => x === v) ? v : dflt) },
    set: (id) => { const v = of(id); return v === undefined ? undefined : s.set({ [key]: v === dflt ? null : v }) },
    preview: d.preview ? (id) => s.preview(id === null ? null : { [key]: of(id) }) : undefined,
  }
}
