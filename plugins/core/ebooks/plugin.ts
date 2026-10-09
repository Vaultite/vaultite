// E-books' server side: an EPUB's or FictionBook's text (title, authors, chapters in spine order, all of it) for
// /api/render and search. Kindle files and comics are only drawn.
import { Plugin, unzip, xmlDecode, zipText } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** (X)HTML as Markdown-ish text: headings as headings, blocks a paragraph apart, every other tag gone. */
export function htmlText(html: string) {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  return xmlDecode(body
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n\n`)
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|section|tr|title)>|<(p|div|li|blockquote|section|tr)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

const resolve = (dir: string, href: string) => {
  const parts = dir ? dir.split("/") : []
  for (const p of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (p === "..") parts.pop()
    else if (p !== "." && p !== "") parts.push(p)
  }
  return parts.join("/")
}

/** An EPUB's metadata and text as Markdown. */
export function epubMarkdown(bytes: Buffer): string {
  const zip = unzip(bytes)
  const container = zipText(zip, "META-INF/container.xml")
  const opfPath = container && /<rootfile\b[^>]*full-path="([^"]+)"/.exec(container)?.[1]
  const opf = opfPath ? zipText(zip, opfPath) : null
  if (!opfPath || opf === null) throw new Error("not an EPUB book (no package document)")
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : ""
  const meta = (tag: string) => [...opf.matchAll(new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`, "g"))].map((m) => xmlDecode(m[1].replace(/<[^>]+>/g, "")).trim()).filter(Boolean)
  const items = new Map<string, string>()
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1], href = /\bhref="([^"]+)"/.exec(m[1])?.[1]
    if (id && href) items.set(id, resolve(dir, href))
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => items.get(m[1])).filter((p): p is string => !!p)
  const head = [`# ${meta("title")[0] ?? "Untitled"}`]
  const authors = meta("creator")
  if (authors.length) head.push(`By ${authors.join(", ")}`)
  const chapters: string[] = []
  for (const part of spine) {
    const html = zipText(zip, part)
    const text = html ? htmlText(html) : ""
    if (text) chapters.push(text)
  }
  return [head.join("\n\n"), ...chapters].join("\n\n")
}

/** A FictionBook's title, authors and text as Markdown. */
export function fb2Markdown(xml: string): string {
  const title = /<book-title>([\s\S]*?)<\/book-title>/.exec(xml)?.[1]
  const authors = [...(/<title-info>([\s\S]*?)<\/title-info>/.exec(xml)?.[1] ?? "").matchAll(/<author>([\s\S]*?)<\/author>/g)]
    .map((m) => xmlDecode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()).filter(Boolean)
  const bodies = [...xml.matchAll(/<body\b[^>]*>([\s\S]*?)<\/body>/g)].map((m) => m[1]
    .replace(/<binary\b[\s\S]*?<\/binary>/g, "")
    .replace(/<title>([\s\S]*?)<\/title>/g, (_, t: string) => `<h2>${t.replace(/<[^>]+>/g, " ")}</h2>`)
    .replace(/<(\/?)(section|subtitle|poem|stanza|v|epigraph|cite|empty-line)\b[^>]*>/g, "<$1p>"))
  const head = [`# ${title ? xmlDecode(title).trim() : "Untitled"}`]
  if (authors.length) head.push(`By ${authors.join(", ")}`)
  return [head.join("\n\n"), ...bodies.map((b) => htmlText(`<body>${b}</body>`))].join("\n\n")
}

plugin.provide("text:epub", (bytes: Buffer | string) => epubMarkdown(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)))
plugin.provide("text:fb2", (bytes: Buffer | string) => fb2Markdown(String(bytes)))
