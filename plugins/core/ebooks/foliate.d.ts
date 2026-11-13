// foliate-js has no types: what the reader uses of it (importing it also defines <foliate-view>).
declare module "foliate-js/view.js" {
  export type TocItem = { label: string; href: string; subitems?: TocItem[] }
  export type Book = { metadata?: { title?: unknown; author?: unknown }; toc?: TocItem[]; dir?: string
    sections: { load: () => unknown; unload?: () => void; createDocument?: () => Promise<Document> }[]
    getCover?: () => Promise<Blob | null> }
  export type Relocate = { fraction?: number; cfi?: string; tocItem?: { label?: string } }
  type Events = { relocate: CustomEvent<Relocate>; "external-link": CustomEvent<{ href: string }>; load: CustomEvent<{ doc: Document }> }
  export interface View extends HTMLElement {
    book: Book; open: (b: Book) => Promise<void>; close: () => void
    init: (o: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>
    goTo: (href: string) => Promise<void>; prev: () => Promise<void>; next: () => Promise<void>
    goLeft: () => Promise<void>; goRight: () => Promise<void>
    renderer: HTMLElement & { setStyles?: (css: string) => void }
    addEventListener<K extends keyof Events>(type: K, listener: (e: Events[K]) => void): void
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  }
  export function makeBook(file: File | Blob | string): Promise<Book>
}

interface HTMLElementTagNameMap { "foliate-view": import("foliate-js/view.js").View }
