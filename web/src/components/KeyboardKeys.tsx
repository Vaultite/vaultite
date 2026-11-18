import { useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { KeyBar } from "@/components/KeyBar"
import { keysFor, typesText, useKeysGiven, useVisibleArea } from "@/core/keyboard"
import { phoneApp } from "@/core/phoneapp"
import { cn } from "@/lib/utils"

const appHidesIosBar = !!phoneApp

const typing = () => {
  const at = document.activeElement
  return typesText(at) && !at.closest("[data-own-keys]") ? at : null
}
const remeasureKeyboardForToasts = () => visualViewport?.dispatchEvent(new Event("resize"))

function useTypingField() {
  const [field, setField] = useState(typing)
  useEffect(() => {
    // (on focusout the focus hasn't landed yet)
    const check = () => setTimeout(() => setField(typing()))
    document.addEventListener("focusin", check)
    document.addEventListener("focusout", check)
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", check) }
  }, [])
  return field?.isConnected ? field : null
}

export function KeyboardKeys() {
  const field = useTypingField()
  useKeysGiven()
  const area = useVisibleArea(!!field)
  const given = field && keysFor(field)
  const shown = !!field && !!area?.keyboard && (!!given || appHidesIosBar)
  useLayoutEffect(() => { if (shown) remeasureKeyboardForToasts() }, [shown])
  if (!shown || !field || !area) return null
  const row = given ?? { label: "Keyboard keys", keys: () => [], scroll: false }
  return createPortal(
    <div className={cn("fixed inset-x-0 z-[55] -translate-y-full transition-opacity duration-(--motion-fast)", area.moving && "opacity-0")}
      style={{ top: area.top + area.height }} data-keyboard-keys>
      <KeyBar label={row.label} scroll={row.scroll} keys={row.keys()} hide={() => field.blur()} />
    </div>,
    field.closest<HTMLElement>("dialog[open]") ?? document.body,
  )
}
