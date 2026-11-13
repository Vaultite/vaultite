let lib: typeof import("../../../electron/browser/linktext") | null = null
void import("../../../electron/browser/linktext").then((m) => { lib = m })
export const shownText = (el: HTMLElement) => lib ? lib.textWithLinks(el, lib.shortUrl) : el.innerText || ""
