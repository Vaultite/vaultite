// Workspaces' settings sheet: the current workspace's name, and whether its pins and panels are its own or the default
// ("Use for new workspaces").
import { useState } from "react"
import { commandKeys, Group, notify, Section, SettingRow, setDefaultSidebars, useEnabled } from "@vaultite"
import { current, defaultSidebars, label, patch, pinsForNew, slots, useVersion } from "./state"

const button = "h-7 shrink-0 cursor-pointer rounded-[6px] border-[0.5px] border-border bg-card px-2.5 text-[13px] hover:bg-foreground/[0.05]"

function Name({ n }: { n: number }) {
  const name = slots()?.[n - 1]?.name ?? ""
  const [typed, setTyped] = useState<string | null>(null)
  const save = () => { if (typed !== null && typed.trim() !== name) patch(n, { name: typed.trim() || null }); setTyped(null) }
  return (
    <input aria-label={`Name of workspace ${n}`} value={typed ?? name} placeholder={`Workspace ${n}`} onChange={(e) => setTyped(e.target.value)}
      onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { setTyped(null); e.currentTarget.blur() } }}
      className="h-8 w-44 min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary md:h-7 md:text-[14px]" />
  )
}

export function WorkspaceSettings() {
  useVersion()
  const pinning = useEnabled()("pages") // pinned pages are Pinned's: none without it
  const n = current()
  if (!n) return null
  const d = slots()?.[n - 1] ?? null
  const pins = Array.isArray(d?.pinned) ? d.pinned : null
  const own = d?.sidebars && !defaultSidebars(d.sidebars) ? d.sidebars : null
  return (
    <div data-workspace-settings>
    <Section title={`This workspace: ${label(n)}`}>
      <Group>
        <SettingRow label="Name" sub="Shown in the sidebar's switcher" data-setting="name">
          <Name n={n} />
        </SettingRow>
        {pinning && (
          <SettingRow stack label="Pinned pages" sub={pins ? `Its own: ${pins.length} pinned in this workspace` : "The default, what new workspaces start with"} data-workspace-pins data-setting="pins">
            {pins && <button type="button" className={button} onClick={() => void pinsForNew(n)}>Use for new workspaces</button>}
          </SettingRow>
        )}
        <SettingRow stack data-setting="panels" label="Panels" sub={own ? "Its own: changed in this workspace" : "The default, what new workspaces start with"}>
          {own && <button type="button" className={button} onClick={() => { setDefaultSidebars(own); notify("New workspaces start with these panels") }}>Use for new workspaces</button>}
        </SettingRow>
      </Group>
      <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">
        Kept in this workspace only, for every device on it. Switch workspaces in the sidebar's header{commandKeys("workspace:1") && `, or with ${commandKeys("workspace:1")} to ${commandKeys("workspace:5")}`}.
      </p>
    </Section>
    </div>
  )
}
