// Settings > AI: the Use AI switch, then, while it's on, the coding agents on the server's machine (their paths only on
// hover) with the companion's, and the parts plugins add here (`settingsPages` with `in: "ai"`: Connections' apps).
import { Fragment, useRef, type ReactNode } from "react"
import type { Store } from "@/core/data"
import { hasCompanion, setCompanion, useAi, useCodingAgents, useCompanionAgent, type CodingAgent } from "@/core/ai"
import { openDetail } from "@/core/nav"
import { isEnabled, pluginById, PLUGINS, setSwitch, switchedOn, useAgents, usePluginsVersion, type Agent } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { coreSwitch } from "@/core/switches"
import { openMenu } from "@/components/ContextMenu"
import { Group, LoadingRows, Section, SettingRow, Switch } from "@/components/kit"
import { SwitchRow } from "@/components/SwitchRow"

/** The parts plugins that are on add to the AI section, in plugin order. */
export function aiParts(disabled: string[]) {
  return PLUGINS.filter((p) => p.settingsPages && isEnabled(p.id, disabled)).flatMap((p) =>
    Object.entries(p.settingsPages!).filter(([, d]) => d.in === "ai").map(([k, d]) => ({ ...d, id: `${p.id}:${k}` })))
}

/** A line under a section's title. */
const Sub = ({ children }: { children: string }) => (
  <p className="mb-1.5 text-[13px] leading-[18px] text-muted-foreground md:px-1 md:text-[12px] md:leading-[16px]">{children}</p>
)

export function AiPanel({ store }: { store: Store }) {
  const on = useAi(), { disabled } = usePrefs()
  usePluginsVersion()
  return (
    <div className="flex flex-col gap-6">
      <Group><SwitchRow s={coreSwitch("setting:ai")} /></Group>
      {on && <CodingAgents />}
      {on && aiParts(disabled).map((d) => (
        <section key={d.id} aria-label={d.label} data-ai-part={d.id}>
          <Section title={d.label}>
            {d.sub && <Sub>{d.sub}</Sub>}
            {d.render({ store })}
          </Section>
        </section>
      ))}
    </div>
  )
}

/** A path on the server's machine as its owner reads it: the home folder as ~. */
const shortPath = (p: string) => p.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Z]:\\Users\\[^\\]+(?=\\|$)/i, "~")

/** "A", "A and B", "A, B and C" of the names, each its own node. */
function spoken(nodes: ReactNode[]) {
  return nodes.map((n, i) => <Fragment key={i}>{i === 0 ? "" : i === nodes.length - 1 ? " and " : ", "}{n}</Fragment>)
}

function CodingAgents() {
  const { list, error } = useCodingAgents()
  const prefs = usePrefs(), running = useAgents()
  const found = list?.filter((a) => a.path) ?? [], others = list?.filter((a) => !a.path) ?? []
  return (
    <section aria-label="Coding agents" data-ai-agents>
      <Section title="Coding agents">
        <Sub>Agents run in Vaultite's terminals. Your companion is the one you talk to.</Sub>
        <Group>
          {!list ? (error ? <p className="py-3 text-[15px] text-muted-foreground md:text-[13px]">Couldn't look for them on this computer.</p> : <LoadingRows count={2} meta={false} />)
            : found.length ? found.map((a) => <AgentRow key={a.id} a={a} on={!!pluginById(a.id) && switchedOn(pluginById(a.id)!, prefs)} />)
            : <p className="py-3 text-[15px] text-muted-foreground md:text-[13px]" data-ai-none>No coding agent on this computer.</p>}
          {list && <CompanionRow running={running} />}
        </Group>
        {!!others.length && (
          <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground md:px-1 md:text-[12px] md:leading-[16px]" data-ai-others>
            Also works with {spoken(others.map((a) => <a key={a.id} href={a.site} target="_blank" rel="noreferrer" className="underline decoration-foreground/25 underline-offset-2 hover:text-foreground">{a.name}</a>))}.
          </p>
        )}
      </Section>
    </section>
  )
}

/** One found: its switch (its plugin's), or Get when its plugin is in Vaultite's directory and not here yet. */
function AgentRow({ a, on }: { a: CodingAgent; on: boolean }) {
  const p = pluginById(a.id)
  const tip = shortPath(a.path!)
  if (!p) return <SettingRow label={a.name} value="Get" onClick={() => openDetail(`plugin-get/${a.id}`)} data-tip={tip} data-ai-agent={a.id} />
  return (
    <SettingRow label={a.name} data-tip={tip} data-ai-agent={a.id} data-on={on || undefined}>
      <Switch on={on} onChange={(v) => setSwitch(p, v)} label={a.name} />
    </SettingRow>
  )
}

/** Which of the agents on is the companion (when there's one): a choice once there are two. */
function CompanionRow({ running }: { running: Agent[] }) {
  const current = useCompanionAgent(), ref = useRef<HTMLDivElement>(null)
  if (!hasCompanion() || !running.length) return null
  const mine = running.find((a) => a.name === current.split("_")[0])
  // (under the row's value, at its right)
  const choose = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) openMenu({ x: r.right - 180, y: r.bottom - 4, flip: r.top + 4 }, running.map((a) => ({ label: a.label, icon: a.icon, checked: a === mine, run: () => { if (a !== mine) void setCompanion(a.name) } })))
  }
  return running.length > 1
    ? <div ref={ref}><SettingRow label="Companion" value={mine?.label ?? current} onClick={choose} data-ai-companion={current} /></div>
    : <SettingRow label="Companion" value={mine?.label ?? current} data-ai-companion={current} />
}
