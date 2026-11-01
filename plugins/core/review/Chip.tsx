// What shows without opening Review (the status bar's count, a changed file's chip), apart from Review.tsx, which loads
// with its first tab.
import { GitCompareArrows } from "lucide-react"
import { AmbientButton, cn, fmtAgo, plural, type FileHead } from "@vaultite"
import { reviewFileView, reviewView, useReview, type Pending } from "./open"

export const names = (by: string[]) => (by.length <= 2 ? by.join(" and ") : `${by.slice(0, -1).join(", ")} and ${by.at(-1)}`)
/** "ChatGPT edited", "Claude and Codex created". */
export const whoDid = (f: Pending) => `${names(f.by)} ${f.created ? "created" : "edited"}`

/** The status bar's count of files to review, when there are any. */
export function ReviewCount() {
  const n = useReview().data?.files.length ?? 0
  return n ? <AmbientButton icon={GitCompareArrows} text={n} tip={`AI changes to review, ${plural(n, "file")}`} tint="var(--review)" onClick={() => reviewView()} /> : null
}

/** In a changed file's header: Review, opening its review; who changed it and when in its tip (the row stays short). */
export function ReviewChip({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const f = useReview().data?.files.find((x) => x.path === file.path)
  if (!f) return null
  const bar = file.place === "bar"
  const what = `${whoDid(f)} this ${fmtAgo(f.last)}`
  return (
    <button type="button" onClick={() => reviewFileView(file.path)} data-review-chip aria-label={`Review: ${what}`} data-tip={`${what}: review the change`}
      className={cn("flex shrink-0 cursor-pointer items-center gap-1 font-medium text-[var(--review)]",
        bar ? "h-7 rounded-[5px] px-1.5 text-[12px] hover:bg-foreground/[0.06]"
          // (a phone's 44px target, laid out in the line's 32px)
          : "-my-1.5 h-11 px-1 text-[13px] active:opacity-50 md:my-0 md:h-8 md:rounded-[6px] md:px-1.5 md:hover:bg-foreground/[0.06]")}>
      <GitCompareArrows className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
      Review
    </button>
  )
}
