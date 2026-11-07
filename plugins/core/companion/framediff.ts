// Where two pictures of a window differ (live editing rings what an ask changed once its page reloads): cells of a
// grid that changed, joined into boxes. Pure: the desktop app decodes the pictures (electron/helper.ts).

export type Box = { x: number; y: number; w: number; h: number }
/** The boxes that changed (pixels, largest first, at most `most`), or `whole` when most of it did (scrolled, another
 *  page): no one place to ring. */
export type Changed = { boxes: Box[]; whole: boolean }

const CELL = 8
/** A channel this far apart counts (anti-aliasing and a cursor's blink stay under it once a cell needs several). */
const DIFF = 28

/** Where `a` and `b` (4 bytes a pixel, `width` × `height`, same size) differ. */
export function changedBoxes(a: Uint8Array, b: Uint8Array, width: number, height: number, most = 3): Changed {
  const cw = Math.ceil(width / CELL), ch = Math.ceil(height / CELL), on = new Uint8Array(cw * ch)
  let count = 0
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let n = 0
    for (let y = cy * CELL; y < Math.min(height, (cy + 1) * CELL) && n < 3; y += 2) for (let x = cx * CELL; x < Math.min(width, (cx + 1) * CELL); x += 2) {
      const i = (y * width + x) * 4
      if (Math.abs(a[i] - b[i]) > DIFF || Math.abs(a[i + 1] - b[i + 1]) > DIFF || Math.abs(a[i + 2] - b[i + 2]) > DIFF) n++
    }
    if (n >= 3) { on[cy * cw + cx] = 1; count++ }
  }
  if (!count) return { boxes: [], whole: false }
  if (count > cw * ch * 0.5) return { boxes: [], whole: true }
  // (cells two apart are one change: a line's words, a card's border and its text)
  const seen = new Uint8Array(cw * ch), boxes: (Box & { n: number })[] = []
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue
    let x0 = s % cw, x1 = x0, y0 = Math.floor(s / cw), y1 = y0, n = 0
    const stack = [s]
    seen[s] = 1
    while (stack.length) {
      const c = stack.pop()!, cx = c % cw, cy = Math.floor(c / cw)
      n++; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy)
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy, k = ny * cw + nx
        if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && on[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      }
    }
    // (a lone cell is noise: a caret, a spinner's tick)
    if (n >= 2) boxes.push({ x: x0 * CELL, y: y0 * CELL, w: Math.min(width, (x1 + 1) * CELL) - x0 * CELL, h: Math.min(height, (y1 + 1) * CELL) - y0 * CELL, n })
  }
  boxes.sort((p, q) => q.n - p.n)
  return { boxes: boxes.slice(0, most).map(({ x, y, w, h }) => ({ x, y, w, h })), whole: false }
}
