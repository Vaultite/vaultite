// A line to ask the companion something not tied to a note: its session's tab (Timeline.tsx) and the Conversations
// panel's talk. Enter sends; the answer comes as its words do (by its cursor, a phone's card).
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@vaultite"
import { sendMoment } from "./live"
import { unsent } from "./Overlay"

/** `compact`: a sidebar's, at its sizes; `onSent` hears what was asked, to show it at once. */
export function AskLine({ name, compact, onSent, className }: { name: string; compact?: boolean; onSent?: (text: string) => void; className?: string }) {
  const [text, setText] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { const f = field.current; if (f) { f.style.height = "auto"; f.style.height = `${f.scrollHeight}px` } }, [text])
  const send = () => {
    const said = text.trim()
    if (!said) return
    if (!sendMoment({ kind: "ask", agent: name, text: said })) return unsent()
    setText("")
    onSent?.(said)
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }
  return (
    <div className={cn("shrink-0", !compact && "px-4 pb-[max(12px,env(safe-area-inset-bottom))] max-md:px-3", className)} data-ask-line>
      <div className={cn("mx-auto flex w-full items-end gap-1 border-[0.5px] border-border bg-card pr-1 focus-within:border-foreground/25",
        compact ? "rounded-[10px] py-0.5 pl-2.5" : "max-w-[40rem] rounded-[14px] py-1 pl-3.5 shadow-[0_2px_10px_rgb(0_0_0/0.05)]")}>
        <textarea ref={field} value={text} rows={1} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" placeholder={`Ask ${name}…`} aria-label={`Ask ${name}`}
          className={cn("flex-1 resize-none overflow-y-auto bg-transparent outline-none placeholder:text-muted-foreground",
            compact ? "max-h-40 min-h-7 py-1 text-[13px] leading-[18px] max-sm:min-h-8 max-sm:py-1.5" : "max-h-[30dvh] min-h-8 py-1.5 text-[14px] leading-[20px] max-md:min-h-11 max-md:py-2.5 max-md:text-[17px] max-md:leading-[24px]")} />
        <button type="button" aria-label="Send" disabled={!text.trim()} onClick={send} data-send
          className={cn("grid shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground disabled:cursor-default disabled:opacity-40",
            compact ? "my-0.5 size-6 max-sm:size-8" : "size-8 max-md:size-11")}>
          <ArrowUp className={compact ? "size-3.5" : "size-4 max-md:size-5"} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
