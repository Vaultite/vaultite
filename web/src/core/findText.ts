// Finding text in what's drawn (a page, a drawn table or callout in a note), for the finds that light it with CSS
// highlights rather than marks in the DOM: Find and replace's in drawn blocks, Vim's / outside the editor.

/** Where a paragraph or a cell starts: text on either side isn't one run (a match can't span two cells). */
const BREAK = "p, li, td, th, tr, summary, h1, h2, h3, h4, h5, h6, pre, blockquote, div, dt, dd, figcaption"
const SKIP = ".cm-block-bar, style, script, svg, [aria-hidden=true]"

/** What `re` (global) finds in the text drawn in `el`, as ranges in order, at most `max`; `skip`: elements whose
 *  text isn't searched. */
export function textRanges(el: HTMLElement, re: RegExp, max = 1000, skip = ""): Range[] {
  const nodes: { node: Text; at: number }[] = []
  const not = skip ? `${SKIP}, ${skip}` : SKIP
  let text = "", lastBox: Element | null = null
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.parentElement || n.parentElement.closest(not) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const box = n.parentElement?.closest(BREAK) ?? null
    if (text && box !== lastBox) text += "\n"
    lastBox = box
    nodes.push({ node: n, at: text.length })
    text += n.data
  }
  const out: Range[] = []
  if (!nodes.length) return out
  // (the text node holding offset i: a match's start is in the node starting there, its end in the one before)
  const point = (i: number, end: boolean) => {
    let lo = 0, hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (nodes[mid].at < i || (!end && nodes[mid].at === i)) lo = mid; else hi = mid - 1
    }
    return { node: nodes[lo].node, offset: Math.min(i - nodes[lo].at, nodes[lo].node.length) }
  }
  re.lastIndex = 0
  for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
    if (!m[0].length) { re.lastIndex++; continue }
    const a = point(m.index, false), b = point(m.index + m[0].length, true)
    const r = document.createRange()
    r.setStart(a.node, a.offset)
    r.setEnd(b.node, b.offset)
    out.push(r)
  }
  return out
}

/** Open the closed <details> a range is in, so what was found shows. */
export function openAround(r: Range) {
  for (let d = r.startContainer.parentElement?.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])")) {
    (d as HTMLDetailsElement).open = true
  }
}
