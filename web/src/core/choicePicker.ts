import type { Choose } from "@/components/Chooser"
import type { Command } from "@/core/commands"
import type { SettingDecl } from "../../../core/blocks.ts"

export type ChoiceOption = { value: string; label: string }
export type ChoiceDef = {
  id: string
  name: string
  sub?: () => string
  words?: string
  icon?: Command["icon"]
  section?: string
  plugin?: { id: string; key: string }
  options: () => ChoiceOption[]
  get: () => string
  set: (value: string) => unknown
  preview?: (value: string | null) => void
  when?: () => boolean
}

export const choiceLabel = (c: ChoiceDef, value = c.get()) => c.options().find((o) => o.value === value)?.label ?? value

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
