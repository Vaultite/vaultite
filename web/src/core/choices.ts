// A plugin's settings of a few values (an enum in its manifest), in the palette: "Show pinned pages as…" offers its
// values in the chooser, the one in use checked; Mod+Enter opens it in Settings. On/off ones are core/switches.ts.
import type { Command } from "@/core/commands"
import { choose } from "@/components/Chooser"
import { notify, notifyError } from "@/core/notify"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { openPluginSettings, pluginSettings, settingDefault, valueLabel } from "@/core/pluginSettings"
import { getPrefs } from "@/core/prefs"
import { capitalize } from "@/lib/utils"

/** Each one of the plugins that are on, as a command. Not a `local` one (who may reach this machine: chosen in its
 *  settings, where what it does is read first). */
export function choiceCommands(disabled = getPrefs().disabled): Command[] {
  return PLUGINS.filter((p) => isEnabled(p.id, disabled)).flatMap((p) => Object.entries(p.settingsDecls ?? {}).flatMap(([key, d]): Command[] => {
    if (d.type !== "enum" || !d.values?.length || d.local) return []
    const s = pluginSettings<Record<string, unknown>>(p.id)
    const now = () => { const v = s.get()[key]; return d.values!.some((x) => x === v) ? v : settingDefault(p.id, key, d) }
    // The default again: the key goes, so the vault keeps only what was chosen.
    const set = (v: unknown) => s.set({ [key]: v === settingDefault(p.id, key, d) ? null : v }).catch((e) => notifyError(e, "Couldn't change it"))
    const pick = () => {
      const was = now()
      choose({
        title: d.label, placeholder: `${d.label}…`, heading: d.description ? capitalize(d.description) : undefined, current: String(was),
        items: d.values!.map((v) => ({ id: String(v), label: valueLabel(d, v) })),
        onPick: (it) => {
          const v = d.values!.find((x) => String(x) === it.id)
          if (v === undefined || v === was) return
          void set(v)
          notify(`${d.label}: ${valueLabel(d, v)}`, { id: "switch", action: { label: "Undo", run: () => void set(was) } })
        },
      })
    }
    return [{
      id: `setting:${p.id}:${key}`, name: `${d.label}…`, icon: p.icon, run: pick,
      words: [p.name, d.description, ...d.values.map((v) => valueLabel(d, v))].filter(Boolean).join(" "),
      value: () => valueLabel(d, now()), place: { name: p.name, open: () => openPluginSettings(p.id, key) },
    }]
  }))
}
