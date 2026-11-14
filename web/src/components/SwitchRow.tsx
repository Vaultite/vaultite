import { useSwitches, type SwitchDef } from "@/core/switches"
import { ResetButton, SettingRow, Switch } from "@/components/kit"
import { switchPictures } from "@/components/SettingPictures"
import { brief } from "@/core/brief"

export function SwitchRow({ s }: { s: SwitchDef }) {
  useSwitches()
  const row = s.plugin ? undefined : s.id.replace(/^setting:/, "")
  const at = row ? { "data-settings-row": row } : { "data-setting": s.plugin!.key }
  const full = s.sub?.() ?? "", short = brief(full)
  return (
    <SettingRow label={s.name} sub={short && short !== full.replace(/\.$/, "") ? <span data-tip={full}>{short}</span> : short || undefined} preview={row ? switchPictures(row, s.get(), s.set) : undefined} {...at}>
      {s.reset && <ResetButton on={s.reset.shown()} onClick={s.reset.run} label={`Reset ${s.name.toLowerCase()}`} />}
      <Switch on={s.get()} onChange={(on) => void s.set(on)} label={s.name} />
    </SettingRow>
  )
}
