// Where a Talk key's words may go in the window: only into the companion's own box (its box by the pointer, a comment
// card to it), never the note, field or terminal that had the keyboard. No DOM of its own (tools/test_web.ts).

const BOX = "[data-companion-popover] :is(input, textarea), [data-companion-note] :is(input, textarea)"
/** Whether `el` (what has the keyboard) is a field of the companion's own box. */
export const inCompanionBox = (el: { closest?: (s: string) => unknown } | null | undefined) => !!el?.closest?.(BOX)
