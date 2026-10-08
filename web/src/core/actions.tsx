// A file's actions in the app (core/actions.ts): the ops that act on its kind, from the catalog (read again when the
// plugins on change), run with the file filled in and the rest asked in the palette.
import { actionsFor, type OpAction } from "../../../core/actions.ts"
import { choose } from "@/components/Chooser"
import { getStore } from "@/core/data"
import { get, request } from "@/core/http"
import { anyIcon } from "@/core/icons"
import { notify, notifyError } from "@/core/notify"
import { fileAt } from "@/core/pages"
import { getPrefs } from "@/core/prefs"

type Schema = { type?: string; description?: string; enum?: unknown[] }
type Entry = { id: string; kind: string; plugin: string | null; action: OpAction | null; params: { properties?: Record<string, Schema>; required?: string[] } }
export type FileAction = ReturnType<typeof actionsFor<Entry>>[number]

let catalog: Entry[] = [], loadedFor = ""
/** Read the catalog again when the plugins on have changed since (menus are drawn at once: they show it next time). */
export function loadActions() {
  const p = getPrefs(), key = `${p.disabled.join()}|${p.enabled.join()}`
  if (key === loadedFor) return
  loadedFor = key
  get<Entry[]>("ops").then((c) => { catalog = c.filter((e) => e.action) }, () => { loadedFor = "" })
}

/** What can be done with the file at `path` (not `skip`'s: a plugin's own menu has its own). */
export function fileActions(path: string, skip?: string): FileAction[] {
  loadActions()
  const s = getStore(), f = s ? fileAt(s.files.files, path) : undefined
  return actionsFor(catalog.filter((e) => e.plugin !== skip), { path, type: f?.type ?? null, archived: !!f?.archived })
}

/** A param's value asked in the palette: one of its values, or typed. null: dismissed. */
function ask(label: string, name: string, s: Schema): Promise<unknown> {
  return new Promise((done) => {
    const heading = `${label}: ${s.description ?? name}`
    const values = s.type === "boolean" ? [true, false] : s.enum
    if (values?.length) {
      choose({ title: label, heading, placeholder: name, items: values.map((v, i) => ({ id: String(i), label: String(v) })),
        onPick: (it) => done(values[Number(it.id)]), onDismiss: () => done(null) })
      return
    }
    choose({ title: label, heading, placeholder: `Type ${name}…`, items: [],
      empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type, then Enter</p>,
      other: (t) => ({ id: t, label: `Use "${t}"` }), onPick: (it) => done(it.id), onDismiss: () => done(null) })
  })
}

/** Run a file's action: the params it still needs asked first, its answer told. */
export async function runAction(a: FileAction) {
  const params: Record<string, unknown> = { ...a.params }
  for (const k of a.needs) {
    const v = await ask(a.label, k, a.entry.params.properties?.[k] ?? {})
    if (v === null) return
    params[k] = v
  }
  try {
    const r = await request("POST", `ops/${encodeURIComponent(a.op)}?as=text`, params)
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || r.statusText)
    notify((await r.text()).trim().split("\n")[0] || a.label)
  } catch (e) {
    notifyError(e, `Couldn't ${a.label.toLowerCase()}`)
  }
}

export const actionIcon = (a: FileAction) => (a.icon && anyIcon(a.icon)) || undefined
