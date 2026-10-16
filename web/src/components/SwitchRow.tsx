// A switch's row in Settings, drawn from its declaration (core/switches.ts): its name, what it does, a reset when it
// has one, and the switch.
import { useSwitches, type SwitchDef } from "@/core/switches"
import { ResetButton, SettingRow, Switch } from "@/components/kit"

export function SwitchRow({ s }: { s: SwitchDef }) {
  useSwitches()
  // (a plugin's is found in its sheet by its key, an app section's by its row)
  const at = s.plugin ? { "data-setting": s.plugin.key } : { "data-settings-row": s.id.replace(/^setting:/, "") }
  return (
    <SettingRow label={s.name} sub={s.sub?.()} {...at}>
      {s.reset && <ResetButton on={s.reset.shown()} onClick={s.reset.run} label={`Reset ${s.name.toLowerCase()}`} />}
      <Switch on={s.get()} onChange={(on) => void s.set(on)} label={s.name} />
    </SettingRow>
  )
}
