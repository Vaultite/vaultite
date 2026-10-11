// Find on a page that isn't a text file (Today, a dashboard, a person's page, a list): what's drawn in the focused pane
// or the open sheet, lit with CSS highlights, in a bar at the top of it. A note's editor has its own (FindBar).
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react"
import { SearchQuery } from "@codemirror/search"
import { cn, numberText, onTabLayoutChange, textRanges, useHeldFocus } from "@vaultite"
import { field, lit, MAX, paintLit, pattern, reveal, scroller, Toggle, tool } from "./FindBar"

type Spec = { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }

/** Where a page find looks: an open sheet, else the focused pane; not a terminal (its text is drawn, not laid out). */
export function pageRoot(): HTMLElement | null {
  const sheet = [...document.querySelectorAll<HTMLElement>("dialog[open]")].reverse().find((d) => d.getClientRects().length > 0)
  const root = sheet ?? document.getElementById("main-scroll")
  return root && !root.querySelector(".xterm") ? root : null
}

/** The page find that's open: what it looks in, what it found and which one is current. */
class PageFind {
  root: HTMLElement
  spec: Spec = { search: "", caseSensitive: false, regexp: false, wholeWord: false }
  ranges: Range[] = []
  current = -1
  valid = true
  host: HTMLElement
  react: Root
  watcher: MutationObserver
  timer: ReturnType<typeof setTimeout> | null = null
  unfollow: () => void
  focusN = 0

  constructor(root: HTMLElement) {
    this.root = root
    this.host = document.createElement("div")
    document.body.append(this.host)
    this.react = createRoot(this.host)
    // What's drawn changes (a list loads, a section opens): found again a moment after.
    this.watcher = new MutationObserver(() => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; this.find(false) }, 150)
    })
    this.watcher.observe(root, { childList: true, subtree: true, characterData: true })
    // (another tab or pane: what was found was found there)
    this.unfollow = onTabLayoutChange(() => { if (!this.root.isConnected || pageRoot() !== this.root) close() })
  }

  /** Find the query again; `seek`: the current match is the first in sight (as you type), else the one nearest the last. */
  find(seek: boolean) {
    const q = new SearchQuery(this.spec)
    this.valid = !this.spec.search || q.valid
    const re = pattern(q)
    const was = this.ranges[this.current]?.getBoundingClientRect().top
    // (not the pane's bar, nor what's hidden, a tab kept drawn or a closed menu; but a closed <details>, opened when
    // it's the current one)
    this.ranges = re ? textRanges(this.root, re, MAX, "[data-view-bar]").filter((r) => r.getClientRects().length || r.startContainer.parentElement?.closest("details:not([open])")) : []
    const sc = scroller(this.root, "y") ?? this.root
    const top = sc.getBoundingClientRect().top
    const after = seek || was === undefined ? top : was - 1
    const i = this.ranges.findIndex((r) => r.getBoundingClientRect().top >= after)
    this.current = !this.ranges.length ? -1 : i < 0 ? 0 : i
    this.paint()
    if (seek && this.current >= 0) this.show()
    this.draw()
  }
  step(dir: 1 | -1) {
    if (!this.ranges.length) return
    this.current = (this.current + dir + this.ranges.length) % this.ranges.length
    this.paint()
    this.show()
    this.draw()
  }
  show() {
    const r = this.ranges[this.current]
    if (r) reveal(r, this.root, scroller(r.startContainer.parentElement, "y"), this.host.firstElementChild)
  }
  paint() {
    lit.set(this, { all: this.ranges, current: this.ranges[this.current] ?? null })
    paintLit()
  }
  set(spec: Partial<Spec>) { this.spec = { ...this.spec, ...spec }; this.find(true) }
  draw() { this.react.render(<PageBar find={this} focus={this.focusN} />) }
  destroy() {
    if (this.timer) clearTimeout(this.timer)
    this.watcher.disconnect()
    this.unfollow()
    lit.delete(this)
    paintLit()
    const react = this.react, host = this.host
    setTimeout(() => { react.unmount(); host.remove() }, 0)
  }
}

let open: PageFind | null = null

/** ⌘F where no text file is on screen: the page find, or the keyboard back in it. */
export function openPageFind() {
  const root = pageRoot()
  if (!root) return
  if (open && open.root !== root) close()
  if (!open) open = new PageFind(root)
  open.focusN++
  open.draw()
}
function close() { open?.destroy(); open = null }

/** Where the bar goes: the top right of the pane (under its bar) or the sheet. */
function spotOf(root: HTMLElement) {
  const box = root.getBoundingClientRect()
  // (the pane's bar sits over the top of its scroller: as tall as an editor's find bar keeps clear of)
  const probe = document.createElement("div")
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--vau-panel-top,0px)"
  root.append(probe)
  const under = root.tagName === "DIALOG" ? 0 : probe.offsetHeight
  probe.remove()
  const width = Math.min(440, box.width - 24)
  return { top: box.top + under + 8, left: box.right - width - 12, width }
}

function PageBar({ find, focus }: { find: PageFind; focus: number }) {
  useHeldFocus()
  const [text, setText] = useState(find.spec.search)
  const ref = useRef<HTMLInputElement>(null)
  const [spot] = useState(() => spotOf(find.root))
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [focus])
  const { spec, ranges, current, valid } = find
  const total = ranges.length
  const none = !!spec.search && valid && !total, bad = none || !valid
  const status = !spec.search ? "" : !valid ? "Not a valid regular expression" : none ? "No results"
    : `${numberText(current + 1)} of ${numberText(total)}${total >= MAX ? "+" : ""}`
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    find.step(e.shiftKey ? -1 : 1)
  }
  return (
    <div data-page-find data-overlay data-find-bar className="fixed z-40 flex items-center gap-0.5 rounded-[8px] max-md:flex-wrap max-md:gap-y-1.5 border-[0.5px] border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ top: spot.top, left: spot.left, width: spot.width }}>
      <div className="relative min-w-0 flex-1 max-md:order-first max-md:basis-full">
        <input ref={ref} value={text} placeholder="Find in page" aria-label="Find" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          onChange={(e) => { setText(e.target.value); find.set({ search: e.target.value }) }} onKeyDown={keys}
          className={cn(field, "pr-24", bad ? "ring-[color-mix(in_srgb,var(--red)_55%,transparent)] focus:ring-[color-mix(in_srgb,var(--red)_70%,transparent)]" : "")} />
        <span aria-live="polite" data-find-count className={cn("pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] tabular-nums max-md:text-[13px]", bad ? "text-[var(--red)]" : "text-muted-foreground")}>{status}</span>
      </div>
      <Toggle on={spec.caseSensitive} label="Match case" onClick={() => find.set({ caseSensitive: !spec.caseSensitive })}><CaseSensitive className="size-4" strokeWidth={2} /></Toggle>
      <Toggle on={spec.wholeWord} label="Whole word" onClick={() => find.set({ wholeWord: !spec.wholeWord })}><WholeWord className="size-4" strokeWidth={2} /></Toggle>
      <Toggle on={spec.regexp} label="Regular expression" onClick={() => find.set({ regexp: !spec.regexp })}><Regex className="size-4" strokeWidth={2} /></Toggle>
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border max-md:invisible max-md:ml-auto" />
      <button type="button" aria-label="Previous match" data-tip="Previous match (⇧↵)" disabled={!total} onClick={() => find.step(-1)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronUp className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Next match" data-tip="Next match (↵)" disabled={!total} onClick={() => find.step(1)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronDown className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Close" data-tip="Close (esc)" onClick={close} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
