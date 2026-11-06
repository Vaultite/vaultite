// A note iCloud kept another version of: a banner over its text to merge that version in (in place, to settle where
// they clash) or keep the note as it is. The version is resolved only once the user chose and it's saved.
import { useEffect, useState } from "react"
import { GitCompareArrows } from "lucide-react"
import { Banner, definePlugin, fmtStamp, get, mergeIntoFile, notify, notifyError, Panel, post, useStoreWith } from "@vaultite"

type Listed = { id: string; at: number; from: string }
declare module "@vaultite" {
  interface PluginState {
    /** The files iCloud kept other versions of, on this machine (plugin.ts). */
    syncConflicts?: Record<string, Listed[]>
  }
}

/** A version as GET sync-conflicts/versions has it. */
type Version = Listed & { label: string; text: string | null; base: string | null; merge: "same" | "clean" | "clashes" | "none" }

const enc = encodeURIComponent
const resolve = (path: string, id: string) => post("sync-conflicts/resolve", { path, id })

function OtherVersion({ path }: { path: string }) {
  const listed = useStoreWith((s) => s?.syncConflicts?.[path])
  const key = listed?.map((v) => v.id).join(",") ?? ""
  const [got, setGot] = useState<{ key: string; versions: Version[] } | null>(null)
  /** The version being merged in: its banner gives way to the editor's (its clashes, settled in place). */
  const [working, setWorking] = useState<string | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    get<{ versions: Version[] }>(`sync-conflicts/versions?path=${enc(path)}`).then((r) => { if (live) setGot({ key, versions: r.versions }) }).catch(() => {})
    return () => { live = false }
  }, [path, key])
  const versions = got?.key === key ? got.versions : []
  const v = versions[0]
  if (!key || !v || working === v.id) return null

  const from = `${v.label}, ${fmtStamp(v.at)}`
  /** Let it go, the note kept as it is: its text in File history first. */
  const keepThis = async () => {
    try {
      if (v.text !== null) await post("history/keep", { path, text: v.text })
      await resolve(path, v.id)
      notify(v.merge === "same" ? "Done: everything in it is in this note" : "Kept this one; the other version is in the note's history")
    } catch (e) { notifyError(e, "Couldn't let the other version go") }
  }
  const mergeIn = async () => {
    setWorking(v.id)
    try {
      const r = await mergeIntoFile(path, v.base, v.text ?? "", v.label)
      if (r === "closed" || r === "unsaved") {
        notify(r === "closed" ? "Open the note to merge it in" : "Switch to editing to compare the versions", { kind: "error" })
        return
      }
      await resolve(path, v.id)
      notify(r === "same" ? "Done: everything in it is in this note" : r === "merged" ? `Merged in the version from ${v.label}` : `Settled the version from ${v.label}`)
    } catch (e) { notifyError(e, "Couldn't merge the other version in") } finally { setWorking(null) }
  }
  const many = versions.length > 1
  const lead = many ? `iCloud kept ${versions.length} other versions of this note. The oldest (${from})` : `iCloud kept another version of this note (${from})`
  const text = v.merge === "none" ? `iCloud kept another version of this file (${from}), not text.`
    : v.merge === "same" ? (many ? `${lead} has nothing this one doesn't.` : `iCloud kept an older version of this note (${from}): everything in it is here.`)
    : v.merge === "clean" ? `${lead} ${many ? "has" : "with"} changes this one doesn't have.`
    : `${lead}${many ? "" : " that"} differs from this one.`
  const actions = v.merge === "same" ? [["Dismiss", keepThis] as const]
    : v.merge === "none" ? [["Keep this one", keepThis] as const]
    : [[v.merge === "clean" ? "Merge it in" : "Compare", mergeIn] as const, ["Keep this one", keepThis] as const]
  return <Banner tone={v.merge === "same" ? "info" : "warn"} icon={GitCompareArrows} actions={actions}>{text}</Banner>
}

export default definePlugin({
  noteTop: { version: { render: ({ path }) => <OtherVersion key={path} path={path} /> } },
  preview: () => (
    <Panel title="Sync conflicts" icon={GitCompareArrows} tint="var(--gray)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        When two devices change a note in iCloud Drive at once, iCloud shows one version and keeps the other out of
        sight. A note that has one says so at its top: merge it in (where both changed the same lines, you choose in
        place) or keep the note as it is. The other version's text is kept in the note's history either way.
      </p>
    </Panel>
  ),
})
