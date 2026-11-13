import { useEffect, useMemo, useState } from "react"
import { Bot } from "lucide-react"
import {
  choose, ChipValuesEditor, chipLabel, chipValues, currentFile, definePlugin, getStore, Group, isHidden, notifyError, op, optimistic, patch, PropertyChip,
  Section, setProperty, useLive, useStore, type ChipValue, type FileHead, type Store,
} from "@vaultite"
import "./types"

const KEY = "origin"
const valuesOf = (store: Store | null): ChipValue[] => chipValues(store?.provenance?.values)
const unsetHere = (store: Store | null, place: "bar" | "line" | "status") => place === "status" || !!store?.provenance?.labelUser

const isNote = (path: string) => /\.md$/i.test(path)
const labelled = (path: string) => !!path && !isHidden(path) && !path.startsWith("/")

type Origin = { origin: string | null; from: "frontmatter" | "list" | "file" | null }

function Label({ file, place }: { file: FileHead; place: "bar" | "line" | "status" }) {
  const { store } = useStore()
  if (!labelled(file.path)) return null
  const showUnset = unsetHere(store, place)
  if (!isNote(file.path)) return <OtherLabel file={file} place={place} values={valuesOf(store)} showUnset={showUnset} />
  return <PropertyChip file={file} prop={KEY} values={valuesOf(store)} place={place} showUnset={showUnset} name="Origin" unset="Unlabeled" unsetTip="Who wrote it, you or an AI: not labeled yet" />
}

function OtherLabel({ file, place, values, showUnset }: { file: FileHead; place: "bar" | "line" | "status"; values: ChipValue[]; showUnset: boolean }) {
  const { data } = useLive<Origin>(`provenance/origin?path=${encodeURIComponent(file.path)}`)
  const [set, setSet] = useState<(Origin & { path: string }) | null>(null)
  useEffect(() => setSet(null), [data])
  const now = set?.path === file.path ? set : data
  const head = useMemo<FileHead>(() => ({
    ...file, fm: now?.origin ? { [KEY]: now.origin } : {},
    setProperty: (_key, v) => {
      op<Origin>("provenance.set", { path: file.path, origin: typeof v === "string" ? v : "" })
        .then((r) => setSet({ ...r, path: file.path })).catch((e) => notifyError(e, "Couldn't label it"))
    },
  }), [file, now?.origin])
  const shown = useMemo(() => (now?.from === "file" ? values.map((v) => (v.value === now.origin ? { ...v, hint: "The file says an AI made it" } : v)) : values), [values, now?.from, now?.origin])
  if (!data && !set) return null
  return <PropertyChip file={head} prop={KEY} values={shown} place={place} showUnset={showUnset} name="Origin" unset="Unlabeled" unsetTip="Who made it, you or an AI: not labeled yet" />
}

async function label(v: string | undefined) {
  const path = currentFile()
  try {
    if (isNote(path)) await setProperty(path, KEY, v)
    else await op("provenance.set", { path, origin: v ?? "" })
  } catch (e) { notifyError(e, "Couldn't label it") }
}
const onFile = () => labelled(currentFile())
const has = (v: string) => valuesOf(getStore()).some((x) => x.value === v)

function pick() {
  choose({
    title: "Label the origin",
    placeholder: "Who wrote it?",
    items: [...valuesOf(getStore()).map((v) => ({ id: v.value, label: chipLabel(v), detail: v.hint })), { id: "", label: "Unlabeled", detail: "Remove the label" }],
    onPick: ({ id }) => label(id || undefined),
  })
}

function SettingsPanel({ store }: { store: Store }) {
  const values = valuesOf(store)
  const defaults = chipValues(store.provenance?.defaults)
  const save = (v: ChipValue[] | null) => optimistic((s) => ({ ...s, provenance: { values: v ?? defaults, defaults: s.provenance?.defaults ?? [], labelUser: s.provenance?.labelUser } }),
    () => patch("config/plugin/provenance", { values: v }), "Couldn't save it").catch(() => {})
  const custom = JSON.stringify(values) !== JSON.stringify(defaults)
  return (
    <Section title="Values">
      <Group><ChipValuesEditor values={values} onChange={(v) => save(v.length ? v : null)} label="Origin's values" /></Group>
      <p className="mt-1.5 flex gap-3 px-1 text-[13px] leading-[18px] text-muted-foreground">
        <span className="flex-1">In the menu in this order. Files keep the value they have: one you remove or rename here shows as it's written.</span>
        {custom && <button type="button" onClick={() => save(null)} data-provenance-reset className="shrink-0 cursor-pointer text-primary">Reset</button>}
      </p>
    </Section>
  )
}

let gutter: Promise<typeof import("./gutter")> | null = null
let gutterMod: typeof import("./gutter") | null = null
const loadGutter = () => (gutter ??= import("./gutter").then((m) => (gutterMod = m)))

export default definePlugin({
  editor: async (ctx) => (ctx.kind === "markdown" && ctx.path && isNote(ctx.path) && labelled(ctx.path) ? (await loadGutter()).authorshipExtension(ctx) : []),
  editorMenu: ({ view, path }) => {
    const at = path && gutterMod ? gutterMod.authorAt(view) : null
    return at ? [{ label: `Written by ${at.tip}`, icon: Bot, run: () => view.dispatch({ selection: { anchor: at.from, head: at.to } }) }] : []
  },
  fileBar: { origin: { sort: 50, render: (file) => <Label file={file} place={file.place} /> } },
  status: { origin: { title: "Origin", sort: 50, render: (file) => <Label file={file} place="status" /> } },
  settingsPanel: ({ store }) => <SettingsPanel store={store} />,
  commands: [
    { id: "provenance:choose", name: "Label who wrote it…", when: onFile, run: pick },
    { id: "provenance:human", name: "Label as written by you (origin: human)", when: () => onFile() && has("human"), run: () => label("human") },
    { id: "provenance:reviewed", name: "Label as reviewed (origin: reviewed)", when: () => onFile() && has("reviewed"), run: () => label("reviewed") },
    { id: "provenance:mixed", name: "Label as written by you and AI (origin: mixed)", when: () => onFile() && has("mixed"), run: () => label("mixed") },
    { id: "provenance:ai", name: "Label as written by AI (origin: ai)", when: () => onFile() && has("ai"), run: () => label("ai") },
    { id: "provenance:clear", name: "Remove the origin label", when: onFile, run: () => label(undefined) },
  ],
})
