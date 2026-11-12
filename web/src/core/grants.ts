import { confirmDialog } from "@/components/ConfirmDialog"
import { getStore, reload, type Store } from "@/core/data"
import { op } from "@/core/http"
import { notifyError } from "@/core/notify"

export type Grant = { plugin: string; name: string; on: boolean; place: string; folder: boolean; why: string; answer: "allowed" | "not now" | "ask" | null
  at: string }

export const grantsOf = (id: string, store: Store | null = getStore()) => (store?.writeGrants ?? []).filter((g) => g.plugin === id)

const said = (list: Grant[]) => list.map((g) => `${g.why} into ${g.at}${g.folder ? "/" : ""}`).join(", and ")

const asking = new Set<string>()

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

export const setGrant = (g: Grant, allow: boolean) =>
  op("plugin.grant", { id: g.plugin, allow, place: g.place }).then(() => reload(), (e) => notifyError(e, "Couldn't change it"))

export const waitingGrants = (store: Store | null) =>
  [...new Set((store?.writeGrants ?? []).filter((g) => g.on && g.answer === "ask").map((g) => g.plugin))]
