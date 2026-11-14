import type { VaultTest } from "./harness.ts"
import { BIG, CAP, fit } from "../../../plugins/core/sync/phone.ts"

export default async ($: VaultTest) => {
  $.check("phone: the default cap is 2 GB and the big-file line 50 MB", CAP === 2 * 1024 ** 3 && BIG === 50 * 1024 ** 2, { CAP, BIG })
  const r = fit([{ path: "a.mp4", size: 300 * 1024 ** 2, why: "kept" }, { path: "b.png", size: 2 * 1024 ** 2, why: "recent" }], CAP)
  $.check("phone: a few kept files fit the default cap", !r.over && r.take.length === 2, r)
}
