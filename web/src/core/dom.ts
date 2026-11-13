export const elementOf = (t: EventTarget | null | undefined): Element | null => (t instanceof Element ? t : null)
export const htmlOf = (t: EventTarget | null | undefined): HTMLElement | null => (t instanceof HTMLElement ? t : null)
export const nodeOf = (t: EventTarget | null | undefined): Node | null => (t instanceof Node ? t : null)
