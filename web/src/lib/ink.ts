/** A colour token as text: its lightness held where it reads on a card (--ink-l in index.css; a class is
 *  `text-ink-(--red)`). Fills and icons on their own keep the token. */
export const ink = (color: string) => `oklch(from ${color} var(--ink-l) c h)`
