import { Fragment, useEffect, useMemo, useState } from "react"
import { FileJson, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { patch, put } from "@/core/http"
import type { Plugin } from "@/core/define"
import { openFile, readFile } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { afterSheets, openDetail } from "@/core/nav"
import { notifyError } from "@/core/notify"
import { isEnabled, names, offText, setSwitch, switchedOn, tileTint } from "@/core/plugins"
import { goingToIn, pluginSettings, revealRow, settingsFile, takeGoingTo } from "@/core/pluginSettings"
import { grantsOf, setGrant } from "@/core/grants"
import { usePrefs } from "@/core/prefs"
import { capitalize } from "@/lib/utils"
import { brief } from "@/core/brief"
import { Group, Loading, Section, SettingRow, SheetHead, Switch } from "@/components/kit"
import { Button } from "@/components/Button"
import { JsonView } from "@/components/JsonView"
import { Catch } from "@/components/Guard"
import { Field } from "@/components/SettingField"
import { SettingsForm } from "@/components/SettingsForm"

const panelFailed = () => <p className="text-[15px] text-muted-foreground">Its settings couldn't be drawn: Edit as JSON, below, still opens them.</p>

type Data = Record<string, unknown>

/** A plugin's settings (its data.json), followed live: null while they load, {} when there are none; `set` writes
 *  those keys (null removes one), shown at once and put back if the write fails. */
export function usePluginSettings(id: string): [Data | null, (changes: Data) => Promise<void>] {
  const s = pluginSettings(id)
  return [s.use(true), s.set]
}

export function PluginSettings({ store, plugin, embedded = false }: { store: Store; plugin: Plugin; embedded?: boolean }) {
  const { disabled } = usePrefs()
  const on = isEnabled(plugin.id, disabled)
  const blocked = (plugin.requires ?? []).filter((r) => !isEnabled(r, disabled))
  const held = switchedOn(plugin) && (!!plugin.meta?.approval || !!plugin.problems?.length)
  const reveal = useMemo(() => goingToIn(plugin.id), [plugin.id])
  useEffect(() => {
    const key = takeGoingTo(plugin.id)
    if (key) revealRow(`[data-plugin-settings-sheet="${CSS.escape(plugin.id)}"] [data-setting="${CSS.escape(key)}"]`)
  }, [plugin.id])
  return (
    <div data-plugin-settings-sheet={plugin.id}>
      {!embedded && <SheetHead icon={plugin.icon} tint={tileTint(plugin.id)} title={plugin.name} sub={brief(plugin.description)} />}
      {!on && (
        <div className="mb-5 flex min-h-11 items-center gap-3 rounded-card bg-muted px-3.5">
          <span className="flex-1 text-[15px] text-muted-foreground" data-plugin-off-why>{held ? capitalize(offText(plugin, disabled).slice(plugin.name.length + 1)) : blocked.length ? `Off: it needs ${names(blocked)}` : "Off"}</span>
          {held ? <Button onClick={() => openDetail(`plugin/${plugin.id}`)} data-plugin-off-review={plugin.id}>Review</Button>
            : <Switch on={false} onChange={() => setSwitch(plugin, true)} label={`${plugin.name} plugin`} why={blocked.length ? `Turn on ${names(blocked)} to use ${plugin.name}` : undefined} />}
        </div>
      )}
      <div className="space-y-5" data-settings-body><SheetBody store={store} plugin={plugin} on={on} embedded={embedded} reveal={reveal} /></div>
    </div>
  )
}

function SheetBody({ store, plugin, on, embedded, reveal }: { store: Store; plugin: Plugin; on: boolean; embedded: boolean; reveal: string | null }) {
  const drawn = on && plugin.settingsPanel ? plugin.settingsPanelDraws ?? [] : []
  const decls = Object.fromEntries(Object.entries(plugin.settingsDecls ?? {}).filter(([k]) => !drawn.includes(k)))
  const declared = Object.keys(decls).length > 0
  const hasFile = (store.pluginSettings ?? []).includes(plugin.id)
  const panel = on && plugin.settingsPanel && <Catch fallback={panelFailed}>{plugin.settingsPanel({ store })}</Catch>
  const homes = (store.filing?.homes ?? []).filter((h) => h.plugin === plugin.id)
  const home = homes.length === 1 ? <Home key="home" home={homes[0]} only /> : null
  const bare = !declared && !panel
  return (
    <>
      {panel && plugin.settingsPanelFirst && panel}
      {declared ? <SettingsForm id={plugin.id} decls={decls} offers={plugin.settingChoices} lead={home} reveal={reveal} /> : home && <Group>{home}</Group>}
      {panel && !plugin.settingsPanelFirst && panel}
      {homes.length > 1 && <Section title="Folders"><Group>{homes.map((h) => <Home key={h.key} home={h} />)}</Group></Section>}
      <Writes store={store} plugin={plugin.id} />
      {bare && hasFile && <SettingsJson path={settingsFile(plugin.id)} />}
      {bare && !hasFile && !embedded && !homes.length && <p className="text-[15px] text-muted-foreground">Nothing set yet.</p>}
      {!embedded && (declared || drawn.length > 0 || hasFile) && <EditJson path={settingsFile(plugin.id)} has={hasFile} />}
    </>
  )
}

function EditJson({ path, has }: { path: string; has: boolean }) {
  const open = async () => {
    try { if (!has) await put("file", { path, text: "{}\n" }) } catch (e) { return notifyError(e, "Couldn't make its settings file") }
    afterSheets(() => openFile(path))
  }
  return (
    <Button look="quiet" size="small" className="-ml-1.5 gap-1.5 px-1.5" data-tip={path} data-settings-edit-json onClick={() => void open()}>
      <FileJson className="size-3.5" strokeWidth={2} />Edit as JSON
    </Button>
  )
}

type HomeOf = NonNullable<Store["filing"]>["homes"][number]
function Home({ home: h, only = false }: { home: HomeOf; only?: boolean }) {
  const save = (v: unknown) =>
    patch("config/folders", { [h.key]: v || null }).catch((e) => notifyError(e, "Couldn't save it"))
  return (
    <Field k={`folder-${h.key}`} value={h.set ? h.folder : undefined} set={(v) => void save(v)}
      d={{ type: "string", folder: true, default: h.folder, label: only ? "Folder" : `${h.label} folder`,
        description: only ? "where its new files go" : `where new ${h.type} files go` }} />
  )
}

function Writes({ store, plugin }: { store: Store; plugin: string }) {
  const list = grantsOf(plugin, store)
  if (!list.length) return null
  return (
    <Section title="Writes on its own">
      <Group>
        {list.map((g) => (
          <SettingRow key={g.place} label={`${g.at}${g.folder ? "/" : ""}`} sub={capitalize(g.why)} data-grant={g.place}>
            <Switch on={g.answer === "allowed"} onChange={(v) => void setGrant(g, v)} label={`Let ${g.name} write ${g.place}`} />
          </SettingRow>
        ))}
      </Group>
    </Section>
  )
}

export function Where({ path, lead, icon: Icon = FileJson, open }: { path: string; lead: string; icon?: LucideIcon; open?: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px] leading-[18px] text-muted-foreground" data-settings-where>
      <Icon className="size-4 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1 break-words">{lead} <code className="text-[12px]">{path.split("/").map((p, i) => <Fragment key={i}>{i > 0 && <>/<wbr /></>}{p}</Fragment>)}</code></span>
      {open && (
        <button type="button" onClick={() => afterSheets(open)} data-settings-open
          className="h-7 shrink-0 cursor-pointer rounded-control border-[0.5px] border-border bg-card px-2.5 text-[13px] text-foreground hover:bg-foreground/[0.05]">
          Open
        </button>
      )}
    </div>
  )
}

function SettingsJson({ path }: { path: string }) {
  const [file, setFile] = useState<{ text: string } | null>(null)
  const read = () => { readFile(path).then((f) => setFile({ text: f.text }), () => setFile({ text: "{}" })) }
  useEffect(read, [path])
  useVaultChange(read, [path])
  if (!file) return <div className="min-h-12 px-3 py-2"><Loading /></div>
  const change = (text: string) => {
    const base = file.text
    setFile({ text })
    put("file", { path, text, base }).catch((e) => { read(); notifyError(e, "Couldn't save it") })
  }
  return <div className="rounded-card bg-foreground/[0.04] px-3 py-2" data-settings-json><JsonView text={file.text} editable onChange={change} /></div>
}
