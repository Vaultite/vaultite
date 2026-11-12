import { actionsFor } from "../../../core/actions.ts"
import type { OpEntry as Entry, Schema } from "../../../core/contracts/ops.ts"
import { askText, choose } from "@/components/Chooser"
import { getStore } from "@/core/data"
import { get, request } from "@/core/http"
import { anyIcon } from "@/core/icons"
import { notify, notifyError } from "@/core/notify"
import { fileAt } from "@/core/pages"
import { getPrefs } from "@/core/prefs"

export type FileAction = ReturnType<typeof actionsFor<Entry>>[number]

let catalog: Entry[] = [], loadedFor = ""
export function loadActions() {
  const p = getPrefs(), key = `${p.disabled.join()}|${p.enabled.join()}|${p.ai}`
  if (key === loadedFor) return
  loadedFor = key
  get<Entry[]>("ops?actions=1").then((c) => { catalog = c }, () => { loadedFor = "" })
}

export function fileActions(path: string, skip?: string): FileAction[] {
  loadActions()
  const s = getStore(), f = s ? fileAt(s.files.files, path) : undefined
  return actionsFor(catalog.filter((e) => e.plugin !== skip), { path, type: f?.type ?? null, archived: !!f?.archived })
}

function ask(label: string, name: string, s: Schema): Promise<unknown> {
  return new Promise((done) => {
    const heading = `${label}: ${s.description ?? name}`
    const values = s.type === "boolean" ? [true, false] : s.enum
    if (values?.length) {
      choose({ title: label, heading, placeholder: name, items: values.map((v, i) => ({ id: String(i), label: String(v) })),
        onPick: (it) => done(values[Number(it.id)]), onDismiss: () => done(null) })
      return
    }
    askText({ title: label, heading, placeholder: `Type ${name}…`, hint: "Type, then Enter",
      label: (t) => `Use "${t}"`, onText: done, onDismiss: () => done(null) })
  })
}

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
