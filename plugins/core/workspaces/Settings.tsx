// Workspaces' settings sheet: the current workspace's name, and whether its pins and panels are its own or the default
// ("Use for new workspaces").
import { useState } from "react"
import { COLOR_NAMES, colorVar, commandKeys, Group, menuBelow, namedIcon, notify, Section, SettingRow, setDefaultSidebars, useEnabled } from "@vaultite"
import { askIcon, containerItems, current, defaultSidebars, label, lookOf, patch, pinsForNew, slots, tintItems, useVersion } from "./state"

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

/** Its icon, tint and container: each a button saying what it is now, opening its choices. */
function Look({ n }: { n: number }) {
  const { icon, tint } = lookOf(n), box = containerItems(n)
  const Icon = icon ? namedIcon(icon) : null
  return (
    <>
      <SettingRow label="Icon" sub="Shown for its number in the sidebar's switcher" data-setting="icon">
        <span className="flex gap-1.5">
          {icon && <button type="button" className={button} onClick={() => patch(n, { icon: null })}>Remove</button>}
          <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => askIcon(n)} data-workspace-pick-icon>
            {Icon && <Icon className="size-3.5" strokeWidth={2} style={tint ? { color: colorVar(tint) } : undefined} />}{icon ? "Change…" : "Choose…"}
          </button>
        </span>
      </SettingRow>
      <SettingRow label="Colour" sub="The sidebars take a little of it" data-setting="tint">
        <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={(e) => menuBelow(e, tintItems(n))} data-workspace-tint>
          {tint && <span className="size-2.5 rounded-full" style={{ background: colorVar(tint) }} />}{tint ? COLOR_NAMES[tint] : "None"}
        </button>
      </SettingRow>
      {!!box.items.length && (
        <SettingRow label="Container" sub="Where its web pages open, unless their site has one" data-setting="container">
          <button type="button" className={button} onClick={(e) => menuBelow(e, box.items)} data-workspace-container>{box.name ?? "None"}</button>
        </SettingRow>
      )}
    </>
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
        <Look n={n} />
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
