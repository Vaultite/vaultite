// The switches of plugins turned on and off in a Settings section rather than on the Plugins page (a manifest's
// `switchIn`: Vim keys, in Editor), each with its settings a gear away while it's on.
import { Settings2 } from "lucide-react"
import { PLUGINS, setSwitch, switchedOn, usePlugins } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { hasSettings, openPluginSettings, settingsTitle } from "@/core/pluginSettings"
import { switchRow } from "@/core/switches"
import { SettingRow, Switch } from "@/components/kit"

/** The plugins whose switch is in this section. */
const switchesIn = (section: string) => PLUGINS.filter((p) => p.switchIn?.section === section)


export function PluginSwitches({ section }: { section: string }) {
  const prefs = usePrefs()
  usePlugins()
  return switchesIn(section).map((p) => {
    const on = switchedOn(p, prefs), label = p.switchIn!.label
    return (
      <SettingRow key={p.id} label={label} sub={p.description?.split(/[.:;] /)[0]} data-settings-row={switchRow(p.id)}>
        {on && hasSettings(p) && (
          <button type="button" onClick={() => openPluginSettings(p.id)} aria-label={settingsTitle(p.name)} data-tip="Settings" data-plugin-gear={p.id}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground active:opacity-60 md:size-7 md:rounded-[6px]">
            <Settings2 className="size-[18px] md:size-4" strokeWidth={2} />
          </button>
        )}
        <Switch on={on} onChange={(v) => setSwitch(p, v)} label={label} />
      </SettingRow>
    )
  })
}
