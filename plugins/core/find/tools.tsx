import type { KeyboardEvent, ReactNode, Ref } from "react"
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react"
import { cn, keyHint, numberText } from "@vaultite"

/** Counting stops here: a find in a huge file stays quick ("1,000+"). */
export const MAX = 1000

export const tool = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:size-9"
export const field = "h-7 w-full min-w-0 rounded-[6px] bg-card px-2 text-[13px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground focus:ring-primary/60 max-md:h-9 max-md:text-[16px]"
/** A field whose text finds nothing (or isn't a valid expression). */
export const badField = "ring-[color-mix(in_srgb,var(--red)_55%,transparent)] focus:ring-[color-mix(in_srgb,var(--red)_70%,transparent)]"
/** A find's card over what it finds in (a page, a note, a terminal, a web page), placed by its owner. */
export const floatingCard = "rounded-[8px] border-[0.5px] border-border [background:linear-gradient(var(--popover),var(--popover))_var(--background)] p-1 text-popover-foreground shadow-lg"
/** Where a card goes in what it floats over (a pane, a terminal): its top right, as Chrome's. */
export const floatingSpot = "absolute right-3 z-10 w-[min(440px,calc(100%-24px))]"
/** The card as one row. */
export const floatingBar = `flex items-center gap-0.5 max-md:flex-wrap max-md:gap-y-1.5 ${floatingCard}`

/** What a find says beside its field: "3 of 12", "No results"; `current` is 0-based, -1 for none. */
export function countText({ search, valid, total, current, more }: { search: string; valid: boolean; total: number; current: number; more: boolean }) {
  if (!search) return ""
  if (!valid) return "Not a valid regular expression"
  if (!total) return "No results"
  const n = `${numberText(total)}${more ? "+" : ""}`
  return current >= 0 ? `${numberText(current + 1)} of ${n}` : `${n} ${total === 1 && !more ? "result" : "results"}`
}

/** The find field with its count inside it, at its end. */
export function FindField({ inputRef, value, placeholder, status, bad, onChange, onKeyDown }: { inputRef: Ref<HTMLInputElement>; value: string; placeholder: string; status: string
  bad: boolean; onChange: (text: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <div className="relative min-w-0 flex-1 max-md:order-first max-md:basis-full">
      <input ref={inputRef} value={value} placeholder={placeholder} aria-label="Find" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} className={cn(field, "pr-24", bad && badField)} />
      <span aria-live="polite" data-find-count className={cn("pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] tabular-nums max-md:text-[13px]", bad ? "text-ink-(--red)" : "text-muted-foreground")}>{status}</span>
    </div>
  )
}

export function Toggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} data-tip={label} onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      className={cn(tool, on && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}>{children}</button>
  )
}

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regexp: boolean }

/** The options and the buttons after a find field: a switch for each option `spec` has. */
export function FindTools({ spec, set, total, step, close }: { spec: Partial<FindOptions>; set: (o: Partial<FindOptions>) => void; total: number; step: (by: 1 | -1) => void; close: () => void }) {
  return (
    <>
      {spec.caseSensitive !== undefined && <Toggle on={spec.caseSensitive} label="Match case" onClick={() => set({ caseSensitive: !spec.caseSensitive })}><CaseSensitive className="size-4" strokeWidth={2} /></Toggle>}
      {spec.wholeWord !== undefined && <Toggle on={spec.wholeWord} label="Whole word" onClick={() => set({ wholeWord: !spec.wholeWord })}><WholeWord className="size-4" strokeWidth={2} /></Toggle>}
      {spec.regexp !== undefined && <Toggle on={spec.regexp} label="Regular expression" onClick={() => set({ regexp: !spec.regexp })}><Regex className="size-4" strokeWidth={2} /></Toggle>}
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border max-md:invisible max-md:ml-auto" />
      <button type="button" aria-label="Previous match" data-tip={`Previous match (${keyHint("Shift+Enter")})`} disabled={!total} onClick={() => step(-1)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronUp className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Next match" data-tip={`Next match (${keyHint("Enter")})`} disabled={!total} onClick={() => step(1)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronDown className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Close" data-tip={`Close (${keyHint("Escape")})`} onClick={close} onMouseDown={(e) => e.preventDefault()} className={tool} data-find-close>
        <X className="size-4" strokeWidth={2} />
      </button>
    </>
  )
}
