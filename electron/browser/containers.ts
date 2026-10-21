// Containers (the web-viewer's containers.ts): each is a profile "c-<id>", so its pages get a session of their own
// from web.ts like any profile. Here: what deleting one leaves behind is cleared.
import { session } from "electron"
import { handle } from "./engine.ts"
import { partitionOf } from "../web.ts"

handle("containers:clear", async (_win, profile) => {
  if (typeof profile !== "string" || !/^c-[a-z0-9]{1,24}$/.test(profile)) throw new Error("not a container")
  const s = session.fromPartition(partitionOf(profile))
  await s.clearStorageData()
  await s.clearCache()
})
