// Plain TypeScript on bytes, no Node or DOM: Claude Code's mod worker has neither.

/** As kitty graphics takes f=32 pixels: R, G, B, A each, not premultiplied. */
export type Rgba = { width: number; height: number; data: Uint8Array }

export type Limits = { maxPixels: number }

export class Unreadable extends Error {}

export function need(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Unreadable(why)
}

export function sized(width: number, height: number, limits: Limits): void {
  need(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0, `bad size ${width}x${height}`)
  need(width * height <= limits.maxPixels, `too many pixels: ${width}x${height}`)
}
