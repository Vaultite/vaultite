import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { autocompletion, Completion } from "@codemirror/autocomplete"
import { getStore, type Store } from "@/core/data"
import type { SlashItem } from "@/core/define"
import type { IconType } from "@/core/icons"
import { mockStore } from "@/core/mock"
import { SlashPreview } from "@/components/SlashPreview"

const icons = new Map<IconType, Node>()
export function iconNode(Icon: IconType): Node {
  let svg = icons.get(Icon)
  if (!svg) {
    const host = document.createElement("span")
    const root = createRoot(host)
    flushSync(() => root.render(<Icon className="size-[1em]" strokeWidth={2} />))
    svg = host.firstElementChild?.cloneNode(true) ?? document.createElement("span")
    root.unmount()
    if (svg.firstChild) icons.set(Icon, svg)
  }
  const box = document.createElement("span")
  box.className = "cm-slash-icon"
  box.append(svg.cloneNode(true))
  return box
}

let mock: { of: Store; store: Store } | null = null
function sampleStore() {
  const real = getStore()
  if (!real) return null
  if (mock?.of !== real) mock = { of: real, store: mockStore(real) }
  return mock.store
}

export function slashInfo(item: SlashItem): Completion["info"] {
  if (!item.preview && item.sample === undefined && !item.text && !item.description) return undefined
  return () => {
    const store = sampleStore()
    if (!store) return null
    const dom = document.createElement("div")
    const root = createRoot(dom)
    flushSync(() => root.render(<SlashPreview item={item} store={store} />))
    return { dom, destroy: () => setTimeout(() => root.unmount(), 0) }
  }
}

const GAP = 6
export const placeInfo: NonNullable<NonNullable<Parameters<typeof autocompletion>[0]>["positionInfo"]> = (_view, list, option, info, space) => {
  const w = info.right - info.left, h = info.bottom - info.top
  const right = space.right - list.right, left = list.left - space.left
  if (w + GAP <= Math.max(right, left)) {
    const top = Math.max(space.top, Math.min(option.top - 10, space.bottom - h)) - list.top
    return { style: `top: ${top}px; ${w + GAP <= right ? "left" : "right"}: calc(100% + ${GAP}px)` }
  }
  const x = Math.max(space.left, Math.min(list.left, space.right - w)) - list.left
  const below = space.bottom - list.bottom >= h + GAP || space.bottom - list.bottom >= list.top - space.top
  return { style: `left: ${x}px; ${below ? "top" : "bottom"}: calc(100% + ${GAP}px)` }
}
