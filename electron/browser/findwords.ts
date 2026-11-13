// Where a page shows words now (the companion's marks, agent:find), as plugins/core/companion/locate.ts finds them in the
// app's own page. Run in the page (its source sent there), so it uses nothing from outside it.

/** Where the page shows `text` on screen: each place (viewport CSS px) with how well (3: an element named it; 2: its whole
 *  words; 1: inside longer words), shown and on top. */
export function findWords(text: string) {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(), want = norm(text), out: { x: number; y: number; w: number; h: number; q: number }[] = []
  if (!want) return out
  const shown = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  const onTop = (el: Element, r: DOMRect) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 12))), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
    return !!top && (el.contains(top) || top.contains(el))
  }
  const add = (el: Element, r: DOMRect, q: number) => { if (shown(r) && onTop(el, r)) out.push({ x: r.left, y: r.top, w: r.width, h: r.height, q }) }
  for (const el of document.querySelectorAll("[aria-label], [title], img[alt], input[placeholder]")) {
    if ([el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("alt"), el.getAttribute("placeholder")].some((n) => n && norm(n) === want)) add(el, el.getBoundingClientRect(), 3)
  }
  // (each character's block: words across blocks are found only along one row, each just after the one before)
  let flat = "", block: Element | null = null, nb = 0
  const at: [Text, number][] = [], blocks: number[] = [], walk = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const v = n.nodeValue ?? "", p = n.parentElement
    if (!(n instanceof Text) || !v.trim() || !p || p.closest("script, style, noscript, template")) continue
    const b = p.closest("p, div, li, dt, dd, td, th, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, section, article, header, footer, nav, aside, main, figcaption, label, button, option, summary")
    if (b !== block) { nb++; if (flat && !flat.endsWith(" ")) { flat += " "; at.push([n, 0]); blocks.push(nb) } }
    block = b
    for (let i = 0; i < v.length; i++) {
      const c = v[i].toLowerCase()
      if (/[\p{L}\p{N}]/u.test(c)) { flat += c[0]; at.push([n, i]); blocks.push(nb) } else if (flat && !flat.endsWith(" ")) { flat += " "; at.push([n, i]); blocks.push(nb) }
    }
  }
  const letter = ([n, i]: [Text, number]) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, Math.min(i + 1, n.length)); return r.getBoundingClientRect() }
  const oneRow = (i: number, end: number) => {
    for (let k = i + 1; k <= end; k++) {
      if (blocks[k] === blocks[k - 1]) continue
      let a = k - 1, b = k
      while (a > i && flat[a] === " ") a--
      while (b < end && flat[b] === " ") b++
      const x = letter(at[a]), y = letter(at[b]), h = Math.max(x.height, y.height, 1)
      if (Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) < Math.min(x.height, y.height) / 2 || y.left < x.left || y.left - x.right > 4 * h) return false
    }
    return true
  }
  for (let i = flat.indexOf(want), k = 0; i >= 0 && k < 40; i = flat.indexOf(want, i + 1), k++) {
    const whole = (i === 0 || flat[i - 1] === " ") && (i + want.length === flat.length || flat[i + want.length] === " ")
    if (!whole && want.length < 6) continue
    if (!oneRow(i, i + want.length - 1)) continue
    const range = document.createRange()
    range.setStart(at[i][0], at[i][1])
    range.setEnd(at[i + want.length - 1][0], at[i + want.length - 1][1] + 1)
    add(at[i][0].parentElement!, range.getBoundingClientRect(), whole ? 2 : 1)
  }
  return out.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), q: r.q }))
}
