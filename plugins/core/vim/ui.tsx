// What Vim draws in the app's own places: its mode and pending keys in the status bar, and its settings panel.
import { ChevronRight } from "lucide-react"
import { Group, openDetail, Segmented, SettingRow, Switch } from "@vaultite"
import { changeSettings, deviceKeys, setDeviceKeys, useDeviceOn, useEditorKeys, useEditorMode, useSettings, VIMRC, type DeviceKeys } from "./state"
import { openVimrc } from "./vimrc"

const MODES: Record<string, { label: string; color: string }> = {
  normal: { label: "Normal", color: "var(--primary)" },
  insert: { label: "Insert", color: "var(--green)" },
  visual: { label: "Visual", color: "var(--purple)" },
  "visual line": { label: "Visual line", color: "var(--purple)" },
  "visual block": { label: "Visual block", color: "var(--purple)" },
  replace: { label: "Replace", color: "var(--red)" },
}

/** The status bar's Vim mode, while a Vim editor has the keyboard. */
export function ModeChip() {
  const mode = useEditorMode()
  const keys = useEditorKeys()
  if (!mode) return null
  const m = MODES[mode] ?? { label: mode[0].toUpperCase() + mode.slice(1), color: "var(--muted-foreground)" }
  return (
    <span className="flex items-center gap-1.5" data-vim-mode={mode}>
      <span className="rounded-[4px] px-1.5 py-px text-[11px] font-semibold"
        style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 14%, transparent)` }}>{m.label}</span>
      {keys && <span className="font-mono text-[11px] text-foreground">{keys}</span>}
    </span>
  )
}

const DEVICE: { value: DeviceKeys; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
]

/** Vim's settings sheet. */
export function VimSettings() {
  const s = useSettings()
  const on = useDeviceOn()
  return (
    <Group>
        <SettingRow data-setting="outside" label="Vim's keys outside the editor" sub="j and k scroll, f shows link hints, / finds, : opens the command line, in reading view, pages and lists">
          <Switch on={s.app !== false} onChange={(v) => void changeSettings({ app: v ? null : false })} label="Vim's keys outside the editor" />
        </SettingRow>
        <SettingRow data-setting="leader" label="Space is the leader key" sub="Space then F F opens the quick switcher; a hint lists what follows">
          <Switch on={s.leader !== false} onChange={(v) => void changeSettings({ leader: v ? null : false })} label="Space is the leader key" />
        </SettingRow>
        <SettingRow data-setting="clipboard" label="Use the system clipboard" sub="Yanks and deletes are copied; p pastes what was copied elsewhere where the browser allows it">
          <Switch on={s.clipboard !== false} onChange={(v) => void changeSettings({ clipboard: v ? null : false })} label="Use the system clipboard" />
        </SettingRow>
        <SettingRow stack data-setting="device" label="On this device" sub={on ? "Vim's keys are on here" : "Vim's keys are off here: Automatic turns them on with a mouse or trackpad"}>
          <Segmented className="mt-2 w-full max-w-sm" label="Vim's keys on this device" value={deviceKeys()} options={DEVICE} onChange={setDeviceKeys} />
        </SettingRow>
        <SettingRow data-setting="vimrc" label="Vimrc" sub={`Mappings and options for every editor, in ${VIMRC}`} onClick={() => void openVimrc()} chevron={ChevronRight} />
        <SettingRow label="Keys" sub="Everything Vim adds, in the editor and outside it" onClick={() => openDetail("vim-keys")} chevron={ChevronRight} />
    </Group>
  )
}
