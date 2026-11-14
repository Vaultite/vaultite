import { Fragment, useRef, useState, type ReactNode } from "react"
import type { Store } from "@/core/data"
import { hasCompanion, setCompanion, useAi, useCodingAgents, useCompanionAgent, type CodingAgent } from "@/core/ai"
import { openDetail } from "@/core/nav"
import { pluginById, setSwitch, switchedOn, useAgents, usePluginsVersion, type Agent } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { coreSwitch } from "@/core/switches"
import { openMenu, useMenuShowing, type MenuItem } from "@/components/ContextMenu"
import { Group, GroupNote, LoadingRows, Section, SettingRow, Switch } from "@/components/kit"
import { openPluginSettings, pluginSettings, settingDefault, valueLabel } from "@/core/pluginSettings"
import { aiParts } from "@/core/settingsfind"
import { openSettings } from "@/core/apppages"
import { isDesktop } from "@/core/platform"
import { notifyError } from "@/core/notify"
import { SwitchRow } from "@/components/SwitchRow"
import { capitalize } from "@/lib/utils"
import type { SettingDecl } from "../../../core/blocks.ts"

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
            {d.sub && <GroupNote above>{d.sub}</GroupNote>}
            {d.render({ store })}
          </Section>
        </section>
      ))}
    </div>
  )
}

const shortPath = (p: string) => p.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Z]:\\Users\\[^\\]+(?=\\|$)/i, "~")

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
        <Group>
          {!list ? (error ? <p className="py-3 text-[15px] text-muted-foreground md:text-[13px]">Couldn't look for them on this computer.</p> : <LoadingRows count={2} meta={false} />)
            : found.length ? found.map((a) => <AgentRow key={a.id} a={a} on={!!pluginById(a.id) && switchedOn(pluginById(a.id)!, prefs)} />)
            : <p className="py-3 text-[15px] text-muted-foreground md:text-[13px]" data-ai-none>No coding agent on this computer.</p>}
          {list && <CompanionRow running={running} />}
          {list && <CompanionModel />}
        </Group>
        {!!others.length && (
          <GroupNote data-ai-others>
            Also works with {spoken(others.map((a) => <a key={a.id} href={a.site} target="_blank" rel="noreferrer" className="underline decoration-foreground/25 underline-offset-2 hover:text-foreground">{a.name}</a>))}.
          </GroupNote>
        )}
      </Section>
    </section>
  )
}

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

function CompanionRow({ running }: { running: Agent[] }) {
  const current = useCompanionAgent(), ref = useRef<HTMLDivElement>(null)
  if (!hasCompanion() || !running.length) return null
  const mine = running.find((a) => a.name === current.split("_")[0])
  const choose = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) openMenu({ x: r.right - 180, y: r.bottom - 4, flip: r.top + 4 }, running.map((a) => ({ label: a.label, icon: a.icon, checked: a === mine, run: () => { if (a !== mine) void setCompanion(a.name) } })))
  }
  return running.length > 1
    ? <div ref={ref}><SettingRow label="Companion" value={mine?.label ?? current} onClick={choose} data-ai-companion={current} /></div>
    : <SettingRow label="Companion" value={mine?.label ?? current} data-ai-companion={current} />
}

type TalkKey = { summoned_model?: string; summoned_effort?: string }
const OWN_SESSION = "companion"
const named = (d: SettingDecl | undefined, v: string) => (d ? valueLabel(d, v).split(": ") : [v])

function CompanionModel() {
  const p = pluginById("companion"), settings = pluginSettings<TalkKey>("companion"), data = settings.use()
  const ref = useRef<HTMLDivElement>(null)
  const showing = useMenuShowing(), [mine, setMine] = useState(false)
  if (mine && !showing) setMine(false)
  if (!p || !hasCompanion()) return null
  const m = p.settingsDecls.summoned_model, e = p.settingsDecls.summoned_effort
  if (!m) return null
  const dflt = (k: keyof TalkKey, d: SettingDecl | undefined) => (d ? String(settingDefault("companion", k, d)) : "")
  const now = (t: TalkKey) => ({ model: t.summoned_model ?? dflt("summoned_model", m), effort: t.summoned_effort ?? dflt("summoned_effort", e) })
  const save = (k: keyof TalkKey, d: SettingDecl, v: string) =>
    void settings.set({ [k]: v === dflt(k, d) ? null : v }).catch((err) => notifyError(err, "Couldn't save it"))
  const items = (): MenuItem[] => {
    const { model, effort } = now(settings.get())
    return [
      ...(m.values ?? []).map(String).map((v): MenuItem => {
        const [label, hint] = named(m, v)
        return { label, hint: hint && capitalize(hint), checked: v === model, run: () => save("summoned_model", m, v) }
      }),
      ...(e && model !== OWN_SESSION ? [{ label: "Effort", caption: true, sep: true, run: () => {} }, { label: "Effort", run: () => {}, segments: {
        value: effort, pick: (v: string) => save("summoned_effort", e, v),
        options: (e.values ?? []).map(String).map((v) => { const [label, note] = named(e, v); return { value: v, label, note: note && capitalize(note) } }),
      } }] : []),
    ]
  }
  const choose = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    openMenu({ x: r.right - 260, y: r.bottom - 4, flip: r.top + 4 }, items(), false, items)
    setMine(true)
  }
  const { model, effort } = now(data)
  const shown = model === OWN_SESSION ? named(m, model)[0] : `${named(m, model)[0]} · ${named(e, effort)[0]} effort`
  return (
    <>
      <div ref={ref}><SettingRow label="Talk key model" value={shown} onClick={choose} aria-haspopup="menu" aria-expanded={mine && showing} data-ai-model="" /></div>
      <SettingRow label="All companion settings" onClick={() => (isDesktop() ? openSettings("plugin:companion") : openPluginSettings("companion"))} data-ai-companion-settings="" />
    </>
  )
}
