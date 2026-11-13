import { GitCompareArrows } from "lucide-react"
import { AmbientButton, cn, fmtAgo, Group, pluginSettings, plural, SettingRow, type FileHead } from "@vaultite"
import { reviewFileView, reviewView, useReview, type Pending } from "./open"

export const names = (by: string[]) => (by.length <= 2 ? by.join(" and ") : `${by.slice(0, -1).join(", ")} and ${by.at(-1)}`)
export const whoDid = (f: Pending) => `${names(f.by)} ${f.created ? "created" : "edited"}`

export function ReviewCount() {
  const n = useReview().data?.files.length ?? 0
  return n ? <AmbientButton icon={GitCompareArrows} text={n} tip={`AI changes to review, ${plural(n, "file")}`} tint="var(--review)" onClick={() => reviewView()} /> : null
}

export function ReviewChip({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const f = useReview().data?.files.find((x) => x.path === file.path)
  const shown = pluginSettings<{ header?: boolean }>("review").use().header !== false
  if (!f || !shown) return null
  const bar = file.place === "bar"
  const what = `${whoDid(f)} this ${fmtAgo(f.last)}`
  return (
    <button type="button" onClick={() => reviewFileView(file.path)} data-review-chip aria-label={`Review: ${what}`} data-tip={`${what}: review the change`}
      className={cn("flex shrink-0 cursor-pointer items-center gap-1 font-medium text-[var(--review)]",
        bar ? "h-7 rounded-[5px] px-1.5 text-[12px] hover:bg-foreground/[0.06]"
          : "-my-1.5 h-11 px-1 text-[13px] active:opacity-50 md:my-0 md:h-8 md:rounded-[6px] md:px-1.5 md:hover:bg-foreground/[0.06]")}>
      <GitCompareArrows className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
      Review
    </button>
  )
}

export function ReviewSettings() {
  const n = useReview().data?.files.length
  return (
    <Group>
      <SettingRow label="AI changes to review" sub="Keep or revert each, file by file" value={n === undefined ? "" : n ? plural(n, "file") : "None"}
        onClick={() => reviewView()} data-review-waiting />
    </Group>
  )
}
