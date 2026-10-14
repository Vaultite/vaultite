// Finder's Quick Look of a Markdown file (space bar, column view, Get Info): the note drawn as Vaultite reads it, with
// no JavaScript (Quick Look runs none) and nothing fetched. Built into Vaultite.app by electron/quicklook.cjs.
import Foundation
import QuickLookUI
import UniformTypeIdentifiers

@objc(PreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let data = try Data(contentsOf: request.fileURL)
        let name = request.fileURL.deletingPathExtension().lastPathComponent
        let html = Page.html(String(decoding: data.prefix(2_000_000), as: UTF8.self), title: name)
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 820, height: 1000)) { reply in
            reply.stringEncoding = .utf8
            reply.title = name
            return Data(html.utf8)
        }
    }
}

// ---------- Markdown to HTML ----------

/// Replace each match of `pattern` in `s` with what `fn` makes of its groups (nil for a group that didn't match).
func sub(_ s: String, _ pattern: String, _ fn: ([String?]) -> String) -> String {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return s }
    let ns = s as NSString
    var out = "", last = 0
    for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
        out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
        let groups = (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? nil : ns.substring(with: m.range(at: $0)) }
        out += fn(groups)
        last = m.range.location + m.range.length
    }
    return out + ns.substring(from: last)
}

func match(_ s: String, _ pattern: String) -> [String?]? {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
    let ns = s as NSString
    guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
    return (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? nil : ns.substring(with: m.range(at: $0)) }
}

func esc(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

enum Page {
    static func html(_ text: String, title: String) -> String {
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var props = ""
        if lines.first?.trimmingCharacters(in: .whitespaces) == "---",
           let end = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" }) {
            props = properties(Array(lines[1..<end]))
            lines = Array(lines[(end + 1)...])
        }
        let body = blocks(stripComments(lines))
        return """
        <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>\(esc(title))</title><style>\(css)</style></head>
        <body><main><h1 class="title">\(esc(title))</h1>\(props)\(body)</main></body></html>
        """
    }

    /// The frontmatter as a small table of its properties (a list's items joined).
    static func properties(_ fm: [String]) -> String {
        var rows: [(String, [String])] = []
        for l in fm {
            if let m = match(l, #"^([^\s:#][^:]*):\s*(.*)$"#), let k = m[1] {
                let v = (m[2] ?? "").trimmingCharacters(in: .whitespaces)
                let list = v.hasPrefix("[") && v.hasSuffix("]")
                    ? v.dropFirst().dropLast().split(separator: ",").map { unquote(String($0)) }
                    : v.isEmpty ? [] : [unquote(v)]
                rows.append((k, list))
            } else if let m = match(l, #"^\s+-\s+(.*)$"#), let v = m[1], !rows.isEmpty {
                rows[rows.count - 1].1.append(unquote(v))
            }
        }
        if rows.isEmpty { return "" }
        let tr = rows.map { "<tr><th>\(esc($0.0))</th><td>\($0.1.map { inline($0) }.joined(separator: ", "))</td></tr>" }
        return "<table class=\"props\">\(tr.joined())</table>"
    }

    static func unquote(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.count >= 2, let f = t.first, f == t.last, f == "\"" || f == "'" { return String(t.dropFirst().dropLast()) }
        return t
    }

    /// %% comments %% go, as when read; not inside code.
    static func stripComments(_ lines: [String]) -> [String] {
        var out: [String] = [], inComment = false, fence: String? = nil
        for l in lines {
            if fence == nil, !inComment, let m = match(l, #"^\s*(`{3,}|~{3,})"#) { fence = m[1]; out.append(l); continue }
            if let f = fence { if l.trimmingCharacters(in: .whitespaces).hasPrefix(f) { fence = nil }; out.append(l); continue }
            let wasIn = inComment
            var line = "", rest = Substring(l)
            while true {
                guard let r = rest.range(of: "%%") else { if !inComment { line += rest }; break }
                if !inComment { line += rest[..<r.lowerBound] }
                inComment.toggle()
                rest = rest[r.upperBound...]
            }
            if !line.isEmpty || !(wasIn || inComment) { out.append(line) }
        }
        return out
    }

    static let fenceRe = #"^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)"#
    static let listRe = #"^(\s*)([-*+]|\d+[.)])\s+(.*)$"#
    static let ruleRe = #"^\s{0,3}([-*_])(\s*\1){2,}\s*$"#
    static let delimRe = #"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$"#

    static func blocks(_ lines: [String]) -> String {
        var out = "", i = 0
        while i < lines.count {
            let l = lines[i], t = l.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { i += 1; continue }
            if let m = match(l, fenceRe), let f = m[1] {
                let lang = m[2] ?? ""
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(f) { code.append(lines[i]); i += 1 }
                i += 1
                if lang.hasPrefix("block-") {
                    out += "<p class=\"view\">\(esc(String(lang.dropFirst(6)).capitalized)) view, drawn in Vaultite</p>"
                } else if lang == "mermaid" || lang == "dataview" || lang == "query" || lang == "base" {
                    out += "<p class=\"view\">\(esc(lang.capitalized)), drawn in Vaultite</p>"
                } else {
                    out += "<pre><code>\(esc(code.joined(separator: "\n")))</code></pre>"
                }
                continue
            }
            if let m = match(l, #"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$"#), let h = m[1] {
                out += "<h\(h.count)>\(inline(m[2] ?? ""))</h\(h.count)>"
                i += 1; continue
            }
            if match(l, ruleRe) != nil { out += "<hr>"; i += 1; continue }
            if t.hasPrefix(">") {
                var inner: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    inner.append(sub(lines[i], #"^\s*>\s?"#) { _ in "" })
                    i += 1
                }
                if let first = inner.first, let m = match(first, #"^\[!([\w-]+)\][+-]?\s*(.*)$"#) {
                    let type = (m[1] ?? "note").lowercased()
                    let head = (m[2] ?? "").isEmpty ? type.capitalized : inline(m[2]!)
                    out += "<div class=\"callout\" data-type=\"\(esc(type))\"><p class=\"callout-title\">\(head)</p>\(blocks(Array(inner.dropFirst())))</div>"
                } else {
                    out += "<blockquote>\(blocks(inner))</blockquote>"
                }
                continue
            }
            if match(l, listRe) != nil {
                var items: [String] = []
                while i < lines.count {
                    let x = lines[i]
                    if x.trimmingCharacters(in: .whitespaces).isEmpty {
                        if i + 1 < lines.count, match(lines[i + 1], listRe) != nil { i += 1; continue }
                        break
                    }
                    if match(x, listRe) == nil && !x.hasPrefix(" ") && !x.hasPrefix("\t") { break }
                    items.append(x); i += 1
                }
                out += list(items)
                continue
            }
            if l.contains("|"), i + 1 < lines.count, match(lines[i + 1], delimRe) != nil {
                let cells = { (s: String) -> [String] in
                    var c = s.trimmingCharacters(in: .whitespaces)
                    if c.hasPrefix("|") { c.removeFirst() }
                    if c.hasSuffix("|") { c.removeLast() }
                    return c.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                }
                var rows = "<tr>" + cells(l).map { "<th>\(inline($0))</th>" }.joined() + "</tr>"
                i += 2
                while i < lines.count, lines[i].contains("|"), !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows += "<tr>" + cells(lines[i]).map { "<td>\(inline($0))</td>" }.joined() + "</tr>"
                    i += 1
                }
                out += "<table>\(rows)</table>"
                continue
            }
            var para: [String] = []
            while i < lines.count {
                let x = lines[i], xt = x.trimmingCharacters(in: .whitespaces)
                if xt.isEmpty || match(x, fenceRe) != nil || match(x, #"^\s{0,3}#{1,6}\s"#) != nil || xt.hasPrefix(">")
                    || match(x, listRe) != nil || (match(x, ruleRe) != nil && !para.isEmpty) { break }
                para.append(xt); i += 1
            }
            if para.isEmpty { para.append(t); i += 1 }
            out += "<p>\(para.map { inline($0) }.joined(separator: "<br>"))</p>"
        }
        return out
    }

    /// A list's lines, nested by how far each item is indented.
    static func list(_ lines: [String]) -> String {
        struct Item { var indent: Int; var ordered: Bool; var text: String; var more: [String] }
        var items: [Item] = []
        for l in lines {
            if let m = match(l, listRe) {
                let ind = (m[1] ?? "").replacingOccurrences(of: "\t", with: "    ").count
                items.append(Item(indent: ind, ordered: !(["-", "*", "+"].contains(m[2] ?? "-")), text: m[3] ?? "", more: []))
            } else if !items.isEmpty {
                items[items.count - 1].more.append(l.trimmingCharacters(in: .whitespaces))
            }
        }
        var out = "", stack: [(Int, Bool)] = []
        for it in items {
            while let top = stack.last, it.indent < top.0 { out += top.1 ? "</li></ol>" : "</li></ul>"; stack.removeLast() }
            if let top = stack.last, it.indent == top.0 { out += "</li>" }
            if stack.last == nil || it.indent > stack.last!.0 {
                stack.append((it.indent, it.ordered))
                out += it.ordered ? "<ol>" : "<ul>"
            }
            var text = it.text, cls = ""
            if let m = match(text, #"^\[([ xX])\]\s*(.*)$"#) {
                let done = m[1] != " "
                cls = done ? " class=\"task done\"" : " class=\"task\""
                text = "<input type=\"checkbox\" disabled\(done ? " checked" : "")> <span>" + inline(m[2] ?? "") + "</span>"
            } else {
                text = inline(text)
            }
            let more = it.more.filter { !$0.isEmpty }.map { inline($0) }
            out += "<li\(cls)>\(text)\(more.isEmpty ? "" : "<br>" + more.joined(separator: "<br>"))"
        }
        while let top = stack.popLast() { out += top.1 ? "</li></ol>" : "</li></ul>" }
        return out
    }

    /// One line's Markdown: code, embeds, links, emphasis, highlights, tags. Code spans are kept aside first.
    static func inline(_ raw: String) -> String {
        var kept: [String] = []
        let keep = { (html: String) -> String in kept.append(html); return "\u{E000}\(kept.count - 1)\u{E001}" }
        var s = sub(raw, #"\s\^[\w-]+$"#) { _ in "" }
        s = sub(s, #"`([^`]+)`"#) { g in keep("<code>\(esc(g[1]!))</code>") }
        s = sub(s, #"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"#) { g in keep("<span class=\"embed\">\(esc(g[1]!))</span>") }
        s = sub(s, #"!\[([^\]]*)\]\(([^)]*)\)"#) { g in keep("<span class=\"embed\">\(esc((g[1] ?? "").isEmpty ? g[2]! : g[1]!))</span>") }
        s = sub(s, #"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]"#) { g in
            let shown = g[2] ?? g[1]!.replacingOccurrences(of: "#", with: " › ")
            return keep("<span class=\"wiki\">\(esc(shown))</span>")
        }
        s = sub(s, #"\[([^\]]+)\]\(<?([^)\s>]+)>?\)"#) { g in
            let url = g[2]!, safe = url.range(of: #"^(javascript|data|vbscript):"#, options: [.regularExpression, .caseInsensitive]) == nil
            return keep(safe ? "<a href=\"\(esc(url))\">\(esc(g[1]!))</a>" : esc(g[1]!))
        }
        s = sub(s, #"(?<![\w"(])(https?://[^\s<>)]+?)(?=[.,;:!?]*(?:\s|$))"#) { g in keep("<a href=\"\(esc(g[1]!))\">\(esc(g[1]!))</a>") }
        s = esc(s)
        s = sub(s, #"\*\*(.+?)\*\*|__(.+?)__"#) { g in "<strong>\(g[1] ?? g[2]!)</strong>" }
        s = sub(s, #"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)"#) { g in "<em>\(g[1] ?? g[2]!)</em>" }
        s = sub(s, #"~~(.+?)~~"#) { g in "<del>\(g[1]!)</del>" }
        s = sub(s, #"==(.+?)=="#) { g in "<mark>\(g[1]!)</mark>" }
        s = sub(s, #"(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)"#) { g in "\(g[1]!)<span class=\"tag\">#\(g[2]!)</span>" }
        return sub(s, "\u{E000}(\\d+)\u{E001}") { g in kept[Int(g[1]!)!] }
    }

    static let css = """
    :root { color-scheme: light dark; --fg: #1d1d1f; --muted: #6e6e73; --line: #e3e3e6; --code: #f4f4f6; --link: #7c3aed; --mark: #fdf3a7; }
    @media (prefers-color-scheme: dark) { :root { --fg: #e8e8ea; --muted: #9a9aa0; --line: #38383c; --code: #2a2a2e; --link: #b79cff; --mark: #6b5d12; } }
    html { background: Canvas; }
    body { margin: 0; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; color: var(--fg); }
    main { max-width: 720px; margin: 0 auto; padding: 28px 32px 48px; }
    .title { font-size: 28px; line-height: 1.25; margin: 0 0 12px; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.4em; }
    h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 17px; } h4, h5, h6 { font-size: 15px; }
    p { margin: 0.5em 0; }
    a, .wiki { color: var(--link); text-decoration: none; }
    .tag { color: var(--link); background: color-mix(in srgb, var(--link) 12%, transparent); border-radius: 4px; padding: 0 4px; }
    .embed { color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 4px; }
    .embed::before { content: "↳ "; }
    code { font: 13px ui-monospace, "SF Mono", Menlo, monospace; background: var(--code); border-radius: 4px; padding: 1px 4px; }
    pre { background: var(--code); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { margin: 0.6em 0; padding: 0 0 0 14px; border-left: 3px solid var(--line); color: var(--muted); }
    .callout { margin: 0.8em 0; padding: 8px 14px; border-radius: 8px; background: color-mix(in srgb, var(--link) 9%, transparent); }
    .callout-title { font-weight: 600; margin: 0.2em 0; }
    ul, ol { padding-left: 1.5em; margin: 0.4em 0; }
    li.task { list-style: none; margin-left: -1.3em; }
    li.task input { margin: 0 6px 0 0; vertical-align: -1px; accent-color: var(--link); }
    li.task.done > span { color: var(--muted); text-decoration: line-through; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 1.4em 0; }
    table { border-collapse: collapse; margin: 0.8em 0; font-size: 14px; }
    th, td { border: 1px solid var(--line); padding: 4px 10px; text-align: left; vertical-align: top; }
    table.props { font-size: 13px; color: var(--muted); margin: 0 0 1.2em; }
    table.props th, table.props td { border: 0; padding: 1px 16px 1px 0; }
    table.props th { font-weight: 500; }
    mark { background: var(--mark); color: inherit; border-radius: 3px; padding: 0 2px; }
    .view { color: var(--muted); font-style: italic; }
    """
}
