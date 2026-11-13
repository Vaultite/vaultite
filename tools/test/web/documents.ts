import { readFileSync } from "node:fs"
import { check } from "../lib.ts"

{
  const { disarmLinks, DRAWN, linkOf } = await import("../../../plugins/core/documents/untrusted.ts")
  const { parseHTML } = await import("linkedom")
  const src = readFileSync(new URL("../../../plugins/core/documents/Docx.tsx", import.meta.url), "utf8")
  check("Documents: a Word file's embedded HTML (its altChunks) is never drawn", DRAWN.renderAltChunks === false && /renderAsync\([^)]*\bDRAWN\)/.test(src))
  const hrefs = ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/hosts",
    "page.html", "//example.com/", "https://example.com/a", "HTTP://example.com/", "mailto:alice@example.com", "#heading-2"]
  const { document } = parseHTML(`<div>${hrefs.map((h, i) => `<a id="l${i}" href="${h.replace(/"/g, "&quot;")}">x</a>`).join("")}</div>`)
  disarmLinks(document)
  const left = hrefs.map((_, i) => document.getElementById(`l${i}`)?.getAttribute("href") ?? null)
  check("Documents: a Word file's links keep only web, mail and in-document addresses; nothing else can run or navigate",
    left.slice(0, 7).every((h) => h === null) && left.slice(7).join() === hrefs.slice(7).join() && /disarmLinks\(body\)/.test(src), left)
  check("Documents: a click on a Word file's link opens it as the app opens links, or scrolls to its place, never by the browser",
    linkOf("https://example.com/a")?.to === "web" && linkOf("mailto:a@example.com")?.to === "mail" && linkOf("#a%20b")?.to === "place"
    && linkOf("javascript:alert(1)") === null && linkOf("") === null && /e\.preventDefault\(\)/.test(src))
}
