// Vim outside the editor (a reading view, a page, an image, a sheet): what index.tsx's commands run; `AppLayer` draws
// the overlay that's open (hints, find and command bars, the keys sheet), each taking the keyboard only while there.
import { backDetail, detailPath, openDetail } from "@vaultite"
import { ExLine, FindBar } from "./bars"
import { go } from "./find"
import { Hints } from "./hints"
import { getLayer, setLayer, useLayer } from "./layer"

export { editHere, heading, scroll, scrollEdge, scrollSide } from "./scroll"
export { KeysSheet } from "./help"

/** Labels on everything that can be clicked in sight; typing one clicks it (`newTab`: opens it in a new tab). */
export function hints(newTab: boolean) { setLayer({ kind: "hints", newTab }) }
/** Find in the focused pane (/), then the next or previous match (n, N). */
export function find() { setLayer({ kind: "find" }) }
export function findNext(dir: 1 | -1) { go(dir) }
/** The : command line, outside the editor. */
export function exLine() { setLayer({ kind: "ex" }) }

/** The keys sheet's detail path (`details` in index.tsx). */
export const KEYS_DETAIL = "vim-keys"
/** Vim's keys, for where the keyboard is (?): the sheet, or closes it when it's the one open. */
export function showHelp() {
  if (getLayer()) setLayer(null)
  if (decodeURIComponent(location.hash).endsWith(`/${KEYS_DETAIL}`)) backDetail()
  else openDetail(detailPath(KEYS_DETAIL))
}

// The find highlights, in the scheme's colours.
const STYLE = `
::highlight(vim-find) { background-color: color-mix(in srgb, var(--yellow) 35%, transparent); color: inherit; }
::highlight(vim-find-current) { background-color: color-mix(in srgb, var(--orange) 60%, transparent); color: inherit; }
`

/** The overlay that's open, if any (hints, the find bar, the command line). */
export function AppLayer() {
  const layer = useLayer()
  return (
    <>
      <style>{STYLE}</style>
      {layer?.kind === "hints" && <Hints newTab={layer.newTab} />}
      {layer?.kind === "find" && <FindBar />}
      {layer?.kind === "ex" && <ExLine />}
    </>
  )
}
