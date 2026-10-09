// A plugin's settings sheet, the one place its options live: its `settingsPanel`, then a form of its declared
// settings (choosing the default removes the key), or its settings file drawn. No menus inside: choices unfold.
import { type KeyboardEvent, useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, FileJson, Folder, Plus, X, type LucideIcon } from "lucide-react"
import { type Store, useStore } from "@/core/data"
import { get, patch, put } from "@/core/http"
import type { Plugin } from "@/core/define"
import { folderList, openFile, readFile } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { afterSheets } from "@/core/nav"
import { notifyError } from "@/core/notify"
import { isEnabled, names, setSwitch, tintOfPlugin } from "@/core/plugins"
import { revealRow, settingsFile, takeGoingTo } from "@/core/pluginSettings"
import { usePrefs } from "@/core/prefs"
import { capitalize, cn } from "@/lib/utils"
import { Group, Section, Segmented, SettingRow, SheetHead, Switch } from "@/components/kit"
import { JsonView } from "@/components/JsonView"
import { Catch } from "@/components/Guard"
import { chooseFolder } from "@/components/FolderPicker"
import { valueProblem, type SettingDecl, type SettingDecls } from "../../../core/blocks.ts"

const panelFailed = () => <p className="text-[15px] text-muted-foreground">Its settings couldn't be drawn. Its settings file is below.</p>

type Data = Record<string, unknown>
const isMap = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v)
const types = (d: SettingDecl) => (Array.isArray(d.type) ? d.type : [d.type])
/** A description is a lowercase fragment (for AIs, like a block option's); under a label it starts a sentence. */

/** The plugin's settings file as an object, followed live: null while it loads, {} when there's none. */
function useSettingsFile(id: string): [Data | null, (d: Data) => void] {
  const [data, setData] = useState<Data | null>(null)
  const read = () => { get<Data>(`config/plugin/${id}`).then((d) => setData(isMap(d) ? d : {}), () => setData({})) }
  useEffect(read, [id])
  useVaultChange(read, [settingsFile(id)])
  return [data, setData]
}

/** A plugin's settings (its data.json), followed live: null while they load, {} when there are none; `set` writes
 *  those keys (null removes one), shown at once and put back if the write fails. */
export function usePluginSettings(id: string): [Data | null, (changes: Data) => Promise<void>] {
  const [data, setData] = useSettingsFile(id)
  const set = async (changes: Data) => {
    const was = data ?? {}, local = { ...was }
    for (const [k, v] of Object.entries(changes)) if (v === null || v === undefined) delete local[k]; else local[k] = v
    setData(local)
    try { await patch(`config/plugin/${id}`, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v ?? null]))) } catch (e) { setData(was); throw e }
  }
  return [data, set]
}

export function PluginSettings({ store, plugin }: { store: Store; plugin: Plugin }) {
  const { disabled } = usePrefs()
  const on = isEnabled(plugin.id, disabled)
  const decls = plugin.settingsDecls ?? {}
  const declared = Object.keys(decls).length > 0
  const hasFile = (store.pluginSettings ?? []).includes(plugin.id)
  const blocked = (plugin.requires ?? []).filter((r) => !isEnabled(r, disabled))
  // Opened for one setting (the Settings page's search): go to it.
  useEffect(() => {
    const key = takeGoingTo(plugin.id)
    if (key) revealRow(`[data-plugin-settings-sheet="${CSS.escape(plugin.id)}"] [data-setting="${CSS.escape(key)}"]`)
  }, [plugin.id])
  return (
    <div data-plugin-settings-sheet={plugin.id}>
      <SheetHead icon={plugin.icon} tint={tintOfPlugin(plugin.id)} kicker="Settings" title={plugin.name} />
      {!on && (
        <div className="mb-5 flex min-h-11 items-center gap-3 rounded-[10px] bg-muted px-3.5">
          <span className="flex-1 text-[15px] text-muted-foreground">{blocked.length ? `Off: it needs ${names(blocked)}` : "Off"}</span>
          <Switch on={false} onChange={() => setSwitch(plugin, true)} label={`${plugin.name} plugin`} disabled={!!blocked.length} />
        </div>
      )}
      <div className="space-y-5">
        {on && plugin.settingsPanel && <Catch fallback={panelFailed}>{plugin.settingsPanel({ store })}</Catch>}
        {declared && <SettingsForm id={plugin.id} decls={decls} titled={!!plugin.settingsPanel && on} />}
        <Homes store={store} plugin={plugin.id} />
        {!declared && !(plugin.settingsPanel && on) && (hasFile ? <SettingsJson path={settingsFile(plugin.id)} /> : (
          <p className="text-[15px] text-muted-foreground">Nothing set yet.</p>
        ))}
        {(declared || hasFile) && <Where path={settingsFile(plugin.id)} lead={hasFile ? "Kept in" : "Kept, once set, in"}
          open={hasFile ? () => openFile(settingsFile(plugin.id)) : undefined} />}
      </div>
    </div>
  )
}

/** Where something of a plugin's is kept, and Open (the sheet closed first). */
export function Where({ path, lead, icon: Icon = FileJson, open }: { path: string; lead: string; icon?: LucideIcon; open?: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px] leading-[18px] text-muted-foreground" data-settings-where>
      <Icon className="size-4 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1 break-all">{lead} <code className="text-[12px]">{path}</code></span>
      {open && (
        <button type="button" onClick={() => afterSheets(open)} data-settings-open
          className="h-7 shrink-0 cursor-pointer rounded-[6px] border-[0.5px] border-border bg-card px-2.5 text-[13px] text-foreground hover:bg-foreground/[0.05]">
          Open
        </button>
      )}
    </div>
  )
}

// ---------- the form of declared settings

function SettingsForm({ id, decls, titled }: { id: string; decls: SettingDecls; titled: boolean }) {
  const [data, setData] = useSettingsFile(id)
  // (another app's settings make some defaults: .obsidian/templates.json's folder)
  const seeds = useStore().store?.settingDefaults?.[`plugins/${id}/data`]
  const declOf = (k: string): SettingDecl => (seeds && Object.hasOwn(seeds, k) ? { ...decls[k], default: seeds[k] as SettingDecl["default"] } : decls[k])
  if (!data) return <Group><div className="min-h-12" aria-busy /></Group>
  const set = (k: string, v: unknown) => {
    const d = declOf(k)
    // The default again: the key goes (null), so the vault keeps only what was chosen.
    const next = v === undefined || v === null || v === "" || JSON.stringify(v) === JSON.stringify(d.default) ? null : v
    const was = data
    const local = { ...data }
    if (next === null) delete local[k]; else local[k] = next
    setData(local)
    patch(`config/plugin/${id}`, { [k]: next }).catch((e) => { setData(was); notifyError(e, "Couldn't save it") })
  }
  const form = (
    <Group>
      {Object.keys(decls).map((k) => <Field key={k} k={k} d={declOf(k)} value={data[k]} set={(v) => set(k, v)} />)}
    </Group>
  )
  return titled ? <Section title="Options">{form}</Section> : form
}

/** The folders new files of the plugin's kinds go in (and its pages, for Dashboards): each shows the one that applies
 *  (set in .vaultite/folders.json, else another app's or where most of them are); clearing it goes back to that. */
function Homes({ store, plugin }: { store: Store; plugin: string }) {
  const homes = (store.filing?.homes ?? []).filter((h) => h.plugin === plugin)
  if (!homes.length) return null
  const save = (key: string, v: unknown) =>
    patch("config/folders", { [key]: typeof v === "string" ? v : null }).catch((e) => notifyError(e, "Couldn't save it"))
  return (
    <Section title="Folders">
      <Group>
        {homes.map((h) => (
          <Field key={h.key} k={`folder-${h.key}`} value={h.set ? h.folder : undefined} set={(v) => void save(h.key, v)}
            d={{ type: "string", folder: true, default: h.folder, label: homes.length > 1 ? `${h.label} folder` : "Folder",
              description: `where new ${h.label.toLowerCase()} go` }} />
        ))}
      </Group>
    </Section>
  )
}

const field = "h-8 min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary md:h-7 md:text-[14px]"

/** One setting as a form row, by its declaration: what the sheet draws for each declared key, and a plugin's panel can
 *  use for settings kept elsewhere (File explorer's, in .vaultite/files.json). `set(undefined)` puts the default back. */
export function Field({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const ts = types(d)
  const shown = value ?? d.default
  const sub = capitalize(d.description)
  const attrs = { "data-setting": k }
  if (ts.length === 1 && ts[0] === "boolean") {
    return (
      <SettingRow label={d.label} sub={sub} {...attrs}>
        <Switch on={shown === true} onChange={set} label={d.label} />
      </SettingRow>
    )
  }
  if (ts.length === 1 && ts[0] === "enum" && d.values?.length) return <Choice k={k} d={d} value={shown} set={set} />
  if (ts.length === 1 && ts[0] === "number") return <NumberField k={k} d={d} value={value} set={set} />
  if (ts.length === 1 && ts[0] === "list" && d.values?.length) return <Chips k={k} d={d} value={shown} set={set} />
  if (d.folder && ts.length === 1 && ts[0] === "list") return <Folders k={k} d={d} value={value} set={set} />
  if (d.folder && ts.length === 1 && ts[0] === "string") return <FolderField k={k} d={d} value={value} set={set} />
  // (a list of records, not of words: its file says it best)
  const words = !Array.isArray(value) || value.every((x) => typeof x === "string" || typeof x === "number")
  if (ts.every((t) => t === "string" || t === "list") && words) return <TextField k={k} d={d} value={value} set={set} list={ts.includes("list")} />
  // A map (or several shapes): its file says it best.
  return <SettingRow label={d.label} sub={`${sub}. Edit it in the file below`} {...attrs} />
}

const labelOf = (d: SettingDecl, v: unknown) => d.labels?.[String(v)] ?? capitalize(String(v))

/** One of a few short values: segmented; more, a row that unfolds into the choices (a menu can't open over a sheet). */
function Choice({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const [open, setOpen] = useState(false)
  const values = d.values ?? []
  const back = (s: string) => values.find((v) => String(v) === s)
  const short = values.length <= 3 && values.every((v) => labelOf(d, v).length <= 12)
  if (short) {
    return (
      <SettingRow stack label={d.label} sub={capitalize(d.description)} data-setting={k}>
        <Segmented className="w-full sm:w-auto sm:shrink-0 [&>button]:whitespace-nowrap" label={d.label} value={value === undefined ? "" : String(value)}
          options={values.map((v) => ({ value: String(v), label: labelOf(d, v) }))} onChange={(s) => set(back(s))} />
      </SettingRow>
    )
  }
  return (
    <div data-setting={k}>
      <SettingRow label={d.label} sub={capitalize(d.description)} value={value === undefined ? "" : labelOf(d, value)} onClick={() => setOpen(!open)}
        chevron={open ? ChevronDown : ChevronRight} aria-expanded={open} />
      {open && (
        <div role="radiogroup" aria-label={d.label} className="-mt-1 pb-2 pl-1">
          {values.map((v) => {
            const on = String(v) === String(value)
            return (
              <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => { set(v); setOpen(false) }}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-left text-[15px] hover:bg-foreground/[0.04] md:min-h-9 md:text-[14px]">
                <Check className={cn("size-4 shrink-0 text-primary", !on && "invisible")} strokeWidth={2.5} />
                {labelOf(d, v)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Typed, saved on Enter or leaving the field; what doesn't fit (not a number, out of range) says why and isn't saved. */
function NumberField({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? (typeof value === "number" ? String(value) : "")
  const n = text.trim() === "" ? null : Number(text)
  const why = n === null ? "" : Number.isNaN(n) ? "should be a number" : valueProblem(d, n)
  const save = () => { if (typed !== null && !why) set(n); if (!why) setTyped(null) }
  return (
    <SettingRow label={d.label} sub={why ? <span className="text-[var(--red)]">{capitalize(why)}</span> : capitalize(d.description)} data-setting={k}>
      <input inputMode="decimal" aria-label={d.label} value={text} placeholder={d.default !== undefined ? String(d.default) : ""}
        aria-invalid={!!why || undefined} onChange={(e) => setTyped(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { e.stopPropagation(); setTyped(null) } }}
        className={cn(field, "w-20 text-right tabular-nums", why && "border-[var(--red)]")} />
    </SettingRow>
  )
}

/** A text, or a list written as one (comma-separated). Saved on Enter or leaving it; emptied, it's the default again. */
function TextField({ k, d, value, set, list }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void; list: boolean }) {
  const [typed, setTyped] = useState<string | null>(null)
  // (a list is comma-separated, or one item per line when its items may hold commas: `lines`)
  const lines = list && d.lines === true, sep = lines ? "\n" : ", "
  const asText = (v: unknown) => (Array.isArray(v) ? v.join(sep) : typeof v === "string" || typeof v === "number" ? String(v) : "")
  const text = typed ?? asText(value)
  const save = () => {
    if (typed === null) return
    const t = typed.trim()
    set(list ? (t ? t.split(lines ? /\r?\n/ : ",").map((s) => s.trim()).filter(Boolean) : null) : t)
    setTyped(null)
  }
  const keys = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !lines) { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { e.stopPropagation(); setTyped(null) }
  }
  return (
    <SettingRow stack label={d.label} sub={capitalize(d.description) + (lines ? " (one per line)" : list ? " (separate them with commas)" : "")} data-setting={k}>
      {lines
        ? <textarea aria-label={d.label} value={text} placeholder={asText(d.default)} spellCheck={false} autoComplete="off" rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
          onChange={(e) => setTyped(e.target.value)} onBlur={save} onKeyDown={keys} className={cn(field, "h-auto w-full resize-y py-1.5 font-mono md:h-auto sm:w-72")} />
        : <input aria-label={d.label} value={text} placeholder={asText(d.default)} spellCheck={false} autoComplete="off"
          onChange={(e) => setTyped(e.target.value)} onBlur={save} onKeyDown={keys} className={cn(field, "w-full sm:w-48")} />}
    </SettingRow>
  )
}

/** The vault's folders, followed live. */
function useFolders() {
  const files = useStore().store?.files
  return useMemo(() => new Set(files ? folderList(files) : []), [files])
}
const missing = (f: string) => <span className="text-[var(--red)]">There's no folder {f}</span>

/** A folder, chosen from the vault's (or a new one, made); one set that isn't there says so. Cleared, the default. */
function FolderField({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const folders = useFolders()
  const v = typeof value === "string" ? value.replace(/^\/+|\/+$/g, "") : ""
  return (
    <SettingRow stack label={d.label} sub={v && !folders.has(v) ? missing(v) : capitalize(d.description)} data-setting={k}>
      <div className="flex w-full items-center gap-1 sm:w-56">
        <button type="button" aria-label={d.label} onClick={() => chooseFolder(d.label, set)} data-folder-field
          className={cn(field, "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left hover:bg-foreground/[0.03]")}>
          <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className={cn("min-w-0 flex-1 truncate", !v && "text-muted-foreground")}>{v || String(d.default ?? "") || "Choose a folder"}</span>
        </button>
        {v && (
          <button type="button" aria-label={`Clear ${d.label.toLowerCase()}`} data-tip="Back to its default" onClick={() => set(null)}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-7">
            <X className="size-3.5" strokeWidth={2.25} />
          </button>
        )}
      </div>
    </SettingRow>
  )
}

/** Folders, one chip each (one that isn't there in red), and one more chosen like FolderField's. */
function Folders({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const folders = useFolders()
  const list = (Array.isArray(value) ? value : []).map((x) => String(x).replace(/^\/+|\/+$/g, "")).filter(Boolean)
  const chip = "flex min-h-8 items-center gap-1 rounded-full border-[0.5px] text-[14px] md:min-h-7 md:text-[13px]"
  return (
    <SettingRow stack label={d.label} sub={capitalize(d.description)} data-setting={k}>
      <div className="flex flex-wrap gap-1.5 sm:max-w-[60%] sm:justify-end">
        {list.map((f) => (
          <span key={f} data-folder-chip={f} data-tip={folders.has(f) ? undefined : `There's no folder ${f}`}
            className={cn(chip, "pr-0.5 pl-2.5", folders.has(f) ? "border-border" : "border-[var(--red)] text-[var(--red)]")}>
            {f}
            <button type="button" aria-label={`Remove ${f}`} onClick={() => { const rest = list.filter((x) => x !== f); set(rest.length ? rest : null) }}
              className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
              <X className="size-3" strokeWidth={2.25} />
            </button>
          </span>
        ))}
        <button type="button" data-folder-add onClick={() => chooseFolder(d.label, (f) => { if (!list.includes(f)) set([...list, f]) })}
          className={cn(chip, "cursor-pointer border-border px-2.5 text-muted-foreground hover:text-foreground")}>
          <Plus className="size-3.5" strokeWidth={2.25} /> Add a folder
        </button>
      </div>
    </SettingRow>
  )
}

/** A list of some of its values: one chip each, on or off. */
function Chips({ k, d, value, set }: { k: string; d: SettingDecl; value: unknown; set: (v: unknown) => void }) {
  const list = Array.isArray(value) ? value : []
  return (
    <SettingRow stack label={d.label} sub={capitalize(d.description)} data-setting={k}>
      <div className="flex flex-wrap gap-1.5">
        {(d.values ?? []).map((v) => {
          const on = list.includes(v)
          return (
            <button key={String(v)} type="button" aria-pressed={on} onClick={() => set(on ? list.filter((x) => x !== v) : [...list, v])}
              className={cn("min-h-8 cursor-pointer rounded-full border-[0.5px] px-3 text-[14px] md:min-h-7 md:text-[13px]",
                on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {labelOf(d, v)}
            </button>
          )
        })}
      </div>
    </SettingRow>
  )
}

// ---------- no form: the file itself

/** A settings file drawn like a .json file in live preview: values edited in place, saved as a small edit (with the
 *  text it built on, so a change on disk meanwhile is merged or refused); the shape is changed in the file (Open). */
function SettingsJson({ path }: { path: string }) {
  const [file, setFile] = useState<{ text: string } | null>(null)
  const read = () => { readFile(path).then((f) => setFile({ text: f.text }), () => setFile({ text: "{}" })) }
  useEffect(read, [path])
  useVaultChange(read, [path])
  if (!file) return <div className="min-h-12" aria-busy />
  const change = (text: string) => {
    const base = file.text
    setFile({ text })
    put("file", { path, text, base }).catch((e) => { read(); notifyError(e, "Couldn't save it") })
  }
  return <div className="rounded-[10px] bg-foreground/[0.04] px-3 py-2" data-settings-json><JsonView text={file.text} editable onChange={change} /></div>
}
