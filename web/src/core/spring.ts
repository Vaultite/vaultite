// A critically damped spring, stepped exactly for any frame's length (no drift on a slow frame): what glides the
// companion's cursor over the screen (web/src/screen.tsx). Pure, so it's tested alone (tools/test/vault/helper.ts).

/** A point on its way, and its speed (px/s). */
export type Glide = { x: number; y: number; vx: number; vy: number }

/** The stiffness that settles a move (to within 1%) in `ms`. */
export const stiffness = (ms: number) => 6.64 / (ms / 1000)
/** An agent's cursor, in the window and over the screen alike: one cursor, one motion. */
export const CURSOR_SPRING = stiffness(380)

/** One axis of x'' = -w²(x - to) - 2w x', solved: its place and speed `dt` seconds on. */
function axis(x: number, v: number, to: number, w: number, dt: number): [number, number] {
  const d = x - to, b = v + w * d, e = Math.exp(-w * dt)
  return [to + (d + b * dt) * e, (v - w * b * dt) * e]
}

/** Move `g` toward (tx, ty) by `dt` seconds; true once it's there and still (then it's put exactly there). A target
 *  that moves mid-way keeps the speed it had: it bends toward the new one. */
export function glide(g: Glide, tx: number, ty: number, w: number, dt: number) {
  ;[g.x, g.vx] = axis(g.x, g.vx, tx, w, dt)
  ;[g.y, g.vy] = axis(g.y, g.vy, ty, w, dt)
  const still = Math.abs(g.x - tx) < 0.1 && Math.abs(g.y - ty) < 0.1 && Math.hypot(g.vx, g.vy) < 2
  if (still) Object.assign(g, { x: tx, y: ty, vx: 0, vy: 0 })
  return still
}
