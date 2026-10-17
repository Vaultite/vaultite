// The canvases on screen (a drawing's whiteboard), registered by the format that draws one, so others can be there:
// shown on it its own way (an agent's cursor), read it as items and change it with its typed actions.

/** A thing on a canvas as others read it, in the canvas's units (x/y its top left): a shape, a text, an arrow joining
 *  `from` and `to` (items' ids). `text`: its words (a shape's label). */
export type CanvasItem = { id: string; type: string; x: number; y: number; w: number; h: number; text?: string; from?: string; to?: string }
/** Someone else on a canvas: their pointer (in its units), name and colour (a CSS colour), what they have selected. */
export type CanvasPeer = { id: string; name: string; color: string; x: number; y: number; selected?: string[]; busy?: boolean }
export type Point = { x: number; y: number }

export type OpenCanvas = {
  path: string
  el: HTMLElement
  items: () => CanvasItem[]
  /** Itself as an agent reads it: every item, then what's by the user's pointer and what they selected. */
  describe: (at: { pointer?: Point | null; selected?: string[] }) => string
  /** The part the user sees (its units). */
  view: () => Point & { w: number; h: number }
  /** The item whose text the user is typing, if any. */
  editing: () => string | null
  /** The user's pointer over it (its units), and the items they selected. */
  pointer: () => Point | null
  selected: () => string[]
  /** Where a point of it is on screen (client px). */
  toScreen: (p: Point) => Point
  /** Others shown on it, as the canvas draws its collaborators; [] for none. */
  setPeers: (peers: CanvasPeer[]) => void
  /** Its typed actions made as one step its undo takes back (`by`: the peer whose pointer goes to each); throws when
   *  one doesn't fit it as it is now. The items they touched, in order. */
  apply: (actions: unknown[], by?: string) => Promise<string[]>
  /** Called on any change: its items, the user's pointer or selection, its scroll and zoom. */
  subscribe: (fn: () => void) => () => void
}

const open: OpenCanvas[] = []
const subs = new Set<() => void>()
const changed = () => { for (const fn of [...subs]) fn() }

/** A canvas came on screen: registered until it goes (the returned function). */
export function registerCanvas(c: OpenCanvas) {
  open.push(c)
  changed()
  return () => { const i = open.indexOf(c); if (i >= 0) { open.splice(i, 1); changed() } }
}

/** The canvases in the page (a hidden tab's too: `canvasShown` tells). */
export const canvases = () => open.filter((c) => c.el.isConnected)
export const canvasShown = (c: OpenCanvas) => c.el.isConnected && c.el.getClientRects().length > 0
/** The canvas showing `path`: one on screen first. */
export const canvasOf = (path: string) => canvases().filter((c) => c.path === path).sort((a, b) => Number(canvasShown(b)) - Number(canvasShown(a)))[0] ?? null
/** Called when a canvas comes or goes. */
export const onCanvases = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
