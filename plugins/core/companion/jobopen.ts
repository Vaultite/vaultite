import { type OpCtx, OpError } from "../../../core/plugins.ts"
import { isSplitTo, SPLITS } from "../../../core/splitto.ts"
import { type Job, linkOf, queuedLine } from "./jobs.ts"
import type { JobCore } from "./workers.ts"

export const OPENS = ["tab", ...SPLITS] as const

export async function openJob(core: Pick<JobCore, "wake" | "changed" | "clockOf" | "seen">, ctx: OpCtx, j: Job, to = "tab") {
  if (j.state === "waiting") throw new OpError(`"${j.title}" ${queuedLine(j).toLowerCase()}: it has no terminal yet`, 409)
  if (j.state !== "stopped" && await core.wake(ctx, j)) core.changed()
  core.clockOf(j).opened = Date.now()
  core.seen([j.id])
  await ctx.op("ui.open", { path: linkOf(j), ...(isSplitTo(to) ? { split: to } : {}) })
}

export const openedText = (to: string) => (isSplitTo(to) ? `opened in a split ${to}` : "opened in a tab")
