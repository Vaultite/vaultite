// Writes on its own (core/grants.ts, core/writegate.ts): a plugin acting on its own (timers, schedules, hooks) writes
// outside .vaultite/ only where the user allowed. Asked once per plugin, like a phone's permissions: when it's turned on,
// or when a write first wanted it ("ask"); answered in its settings later.
import { confirmDialog } from "@/components/ConfirmDialog"
import { getStore, reload, type Store } from "@/core/data"
import { op } from "@/core/http"
import { notifyError } from "@/core/notify"

/** One place a plugin writes on its own, with the user's answer (null: never asked). */
export type Grant = { plugin: string; name: string; on: boolean; place: string; folder: boolean; why: string; answer: "allowed" | "not now" | "ask" | null
  /** Where it writes now (the declared folder, or where the user moved it). */
  at: string }

export const grantsOf = (id: string, store: Store | null = getStore()) => (store?.writeGrants ?? []).filter((g) => g.plugin === id)

/** "a recap of each day into Recaps/, and ... into ..." */
const said = (list: Grant[]) => list.map((g) => `${g.why} into ${g.at}${g.folder ? "/" : ""}`).join(", and ")

const asking = new Set<string>()

/** Ask the user whether plugin `id` may write where it declares, on its own (`only`: those not answered yet). */
export async function askGrant(id: string, only = true) {
  const list = grantsOf(id).filter((g) => !only || g.answer === null || g.answer === "ask")
  if (!list.length || asking.has(id)) return
  asking.add(id)
  try {
    const ok = await confirmDialog({
      title: `${list[0].name} wants to write ${said(list)}`,
      body: "It does this on its own, not when you ask. Allow it once here; your settings for it can take it back.",
      confirm: "Allow", cancel: "Not now",
    })
    await op("plugin.grant", { id, allow: ok })
    reload()
  } catch (e) {
    notifyError(e, "Couldn't save the answer")
  } finally {
    asking.delete(id)
  }
}

/** Allow or take back one of a plugin's writes (its settings). */
export const setGrant = (g: Grant, allow: boolean) =>
  op("plugin.grant", { id: g.plugin, allow, place: g.place }).then(() => reload(), (e) => notifyError(e, "Couldn't change it"))

/** The plugins that are on whose write wanted a grant never asked about ("ask"), to ask now. */
export const waitingGrants = (store: Store | null) =>
  [...new Set((store?.writeGrants ?? []).filter((g) => g.on && g.answer === "ask").map((g) => g.plugin))]
