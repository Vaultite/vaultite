// `<en-todo/>` and `<en-media/>` are void in ENML, not in HTML
export function fromEnml(enml: string) {
  return enml
    .replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/gi, "")
    .replace(/<en-note\b[^>]*>/i, "<div>").replace(/<\/en-note>/i, "</div>")
    .replace(/<en-todo\b([^>]*?)\/?>(\s*<\/en-todo>)?/gi, (_, a: string) => `<input type="checkbox"${/checked\s*=\s*["']true["']/i.test(a) ? " checked" : ""}>`)
    .replace(/<en-media\b([^>]*?)\/?>(\s*<\/en-media>)?/gi, (_, a: string) => {
      const hash = /hash\s*=\s*["']([0-9a-f]+)["']/i.exec(a)?.[1] ?? ""
      const type = /type\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] ?? ""
      return `<img data-hash="${hash}" data-type="${type}">`
    })
    // Evernote's code block is a div of lines, styled "--en-codeblock:true"
    .replace(/<div\b[^>]*--en-codeblock\s*:\s*true[^>]*>((?:\s*<div\b[^>]*>[\s\S]*?<\/div>)*)\s*<\/div>/gi, (_, inner: string) => {
      const lines = [...inner.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => m[1].replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, ""))
      return `<pre><code>${lines.join("\n")}</code></pre>`
    })
    .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, "<p><em>(encrypted text, not imported)</em></p>")
}
