import { backDetail, detailPath, openDetail } from "@vaultite"
import { ExLine, FindBar } from "./bars"
import { go } from "./find"
import { Hints } from "./hints"
import { getLayer, setLayer, useLayer } from "./layer"

export { editHere, heading, scroll, scrollEdge, scrollSide } from "./scroll"
export { KeysSheet } from "./help"

export function hints(newTab: boolean) { setLayer({ kind: "hints", newTab }) }
export function find() { setLayer({ kind: "find" }) }
export function findNext(dir: 1 | -1) { go(dir) }
export function exLine() { setLayer({ kind: "ex" }) }

export const KEYS_DETAIL = "vim-keys"
export function showHelp() {
  if (getLayer()) setLayer(null)
  if (decodeURIComponent(location.hash).endsWith(`/${KEYS_DETAIL}`)) backDetail()
  else openDetail(detailPath(KEYS_DETAIL))
}

const STYLE = `
::highlight(vim-find) { background-color: color-mix(in srgb, var(--yellow) 35%, transparent); color: inherit; }
::highlight(vim-find-current) { background-color: color-mix(in srgb, var(--orange) 60%, transparent); color: inherit; }
`

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
