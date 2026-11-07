import Foundation
import WebKit

/// The offline app at vaultite-local://app/ (offline.html, bundled), so the web app's relative addresses work as on a
/// server: its files from the bundle, a vault file's bytes from the phone's copy (LocalStore), and every other api/
/// request to the page, whose server runs in a Web Worker: window.__vaultiteLocal.request, answered by Shell's localAnswer.
final class LocalScheme: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    static let scheme = "vaultite-local"
    static let host = "app"
    static let shared = LocalScheme()

    /// The bundled web dir (Capacitor's appLocation: where phone.html is).
    var web: URL?

    // (main thread only) Tasks WebKit hasn't stopped and that aren't answered yet: completing a stopped one throws.
    private var live = Set<ObjectIdentifier>()
    private var asked: [String: (task: WKURLSchemeTask, timeout: DispatchWorkItem)] = [:]
    private let files = DispatchQueue(label: "app.vaultite.local.serve", qos: .userInitiated, attributes: .concurrent)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        live.insert(ObjectIdentifier(task))
        guard let url = task.request.url else { return respond(task, 400, text: "Bad request") }
        let method = task.request.httpMethod?.uppercased() ?? "GET"
        let path = url.path
        if path == "/api" || path.hasPrefix("/api/") {
            if path.hasPrefix("/api/raw/"), method == "GET" || method == "HEAD", let file = vaultFile(url) {
                let download = Self.query(url, "download") != nil
                files.async {
                    var isDir: ObjCBool = false
                    if FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue {
                        self.stream(task, file, head: method == "HEAD", download: download)
                    } else {
                        DispatchQueue.main.async { self.forward(webView, task) }
                    }
                }
                return
            }
            return forward(webView, task)
        }
        guard method == "GET" || method == "HEAD" else { return respond(task, 405, text: "Method not allowed") }
        guard let web, let file = try? LocalStore.file(web, path == "/" || path.isEmpty ? "offline.html" : String(path.dropFirst())) else {
            return respond(task, 404, text: "Not found")
        }
        files.async {
            guard let data = try? Data(contentsOf: file) else {
                return DispatchQueue.main.async { self.respond(task, 404, text: "Not found") }
            }
            let headers = ["Content-Type": Self.type(file.lastPathComponent), "Content-Length": String(data.count), "Cache-Control": "no-cache"]
            DispatchQueue.main.async { self.respond(task, 200, headers: headers, body: method == "HEAD" ? Data() : data) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        live.remove(ObjectIdentifier(task))
        for (id, a) in asked where a.task === task {
            a.timeout.cancel()
            asked[id] = nil
        }
    }

    /// The page's answer to a request it was given (Shell's localAnswer), on the main thread. False: no longer waited for.
    @discardableResult
    func answer(_ id: String, status: Int, headers: [String: String], body: Data) -> Bool {
        guard let a = asked.removeValue(forKey: id) else { return false }
        a.timeout.cancel()
        // The body comes decoded, its length is what's sent.
        var h = headers.filter { !["content-length", "content-encoding", "transfer-encoding"].contains($0.key.lowercased()) }
        h["Content-Length"] = String(body.count)
        respond(a.task, status, headers: h, body: body)
        return true
    }

    // ---------- to the page

    private func forward(_ webView: WKWebView, _ task: WKURLSchemeTask) {
        let request = task.request
        files.async {
            let body = request.httpBody ?? request.httpBodyStream.map(Self.drain)
            DispatchQueue.main.async {
                guard self.live.contains(ObjectIdentifier(task)) else { return }
                let id = UUID().uuidString
                var target = "/"
                if let url = request.url, let c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                    target = (c.percentEncodedPath.isEmpty ? "/" : c.percentEncodedPath) + (c.percentEncodedQuery.map { "?" + $0 } ?? "")
                }
                let message: [String: Any] = [
                    "id": id, "method": request.httpMethod?.uppercased() ?? "GET", "url": target,
                    "headers": request.allHTTPHeaderFields ?? [:], "body": body.map { $0.base64EncodedString() } ?? NSNull(),
                ]
                guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else {
                    return self.respond(task, 500, text: "Couldn't pass the request on")
                }
                let timeout = DispatchWorkItem { [weak self] in
                    self?.answer(id, status: 504, headers: ["Content-Type": "application/json"], body: Data(#"{"error":"the offline app didn't answer"}"#.utf8))
                }
                self.asked[id] = (task, timeout)
                DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
                // (true once the page has it: a page without __vaultiteLocal yet gets a 503 now, not after a minute)
                let js = "(function(m){var l=window.__vaultiteLocal;if(!l||typeof l.request!=='function')return false;l.request(m);return true})(\(json))"
                webView.evaluateJavaScript(js) { result, _ in
                    if (result as? Bool) != true {
                        self.answer(id, status: 503, headers: ["Content-Type": "application/json"], body: Data(#"{"error":"the offline app isn't running"}"#.utf8))
                    }
                }
            }
        }
    }

    private static func drain(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    // ---------- a vault file, from the phone's copy

    /// The copy's file a raw request names, when it's one this side sends (not a thumbnail or a conversion).
    private func vaultFile(_ url: URL) -> URL? {
        guard let vault = LocalStore.offlineVault, LocalStore.valid(vault: vault), let path = Self.query(url, "path"),
              Self.query(url, "thumb") == nil, Self.query(url, "as") == nil else { return nil }
        return try? LocalStore.file(LocalStore.copy(of: vault), path)
    }

    /// A query parameter as the server reads it (URLSearchParams: "+" is a space).
    private static func query(_ url: URL, _ name: String) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQueryItems ?? []
        return items.first { $0.name == name }.map { ($0.value ?? "").replacingOccurrences(of: "+", with: "%20").removingPercentEncoding ?? "" }
    }

    /// As the server's sendFile: the range asked (a video seeks), streamed in chunks, each handed over on the main thread.
    private func stream(_ task: WKURLSchemeTask, _ file: URL, head: Bool, download: Bool) {
        let id = ObjectIdentifier(task)
        let fail = { (status: Int) in DispatchQueue.main.async { self.respond(task, status, text: "Not found") } }
        guard let a = try? FileManager.default.attributesOfItem(atPath: file.path), let handle = try? FileHandle(forReadingFrom: file) else { return fail(404) }
        defer { try? handle.close() }
        let size = (a[.size] as? NSNumber)?.int64Value ?? 0
        let name = file.lastPathComponent
        var headers = [
            "Content-Type": Self.type(name), "Cache-Control": "no-cache", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "\(download ? "attachment" : "inline"); filename*=UTF-8''\(name.addingPercentEncoding(withAllowedCharacters: Self.unreserved) ?? "file")",
        ]
        if let m = a[.modificationDate] as? Date { headers["Last-Modified"] = Self.httpDate(m) }
        // A vault's page or picture runs nothing on the app's origin (it has the bridge), as on the server.
        if (name as NSString).pathExtension.lowercased() != "pdf" {
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
        }
        var start: Int64 = 0, end = size - 1, status = 200
        if let range = Self.range(task.request.value(forHTTPHeaderField: "Range")) {
            if let s = range.start {
                start = s
                if let e = range.end { end = min(e, end) }
            } else if let n = range.end {
                start = max(0, size - n)
            }
            if start > end || start >= size {
                return DispatchQueue.main.async { self.respond(task, 416, headers: ["Content-Range": "bytes */\(size)"], body: Data()) }
            }
            status = 206
            headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
        }
        let length = max(0, end - start + 1)
        headers["Content-Length"] = String(length)
        var alive = false
        DispatchQueue.main.sync {
            alive = self.live.contains(id)
            if alive, let url = task.request.url {
                task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
            }
        }
        guard alive else { return }
        var left = head ? 0 : length
        do {
            try handle.seek(toOffset: UInt64(start))
            while left > 0 {
                guard let chunk = try handle.read(upToCount: Int(min(left, 1 << 20))), !chunk.isEmpty else { break }
                left -= Int64(chunk.count)
                DispatchQueue.main.sync {
                    alive = self.live.contains(id)
                    if alive { task.didReceive(chunk) }
                }
                guard alive else { return }
            }
        } catch {}
        DispatchQueue.main.sync {
            guard self.live.remove(id) != nil else { return }
            // (the file got shorter while it was sent: WebKit is told, not handed a short body)
            if left > 0 { task.didFailWithError(URLError(.networkConnectionLost)) } else { task.didFinish() }
        }
    }

    /// "bytes=a-b", "bytes=a-" or "bytes=-n" (the last n); nil for none or one this doesn't read (the whole file then).
    private static func range(_ header: String?) -> (start: Int64?, end: Int64?)? {
        guard let header, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst(6)
        guard !spec.contains(","), let dash = spec.firstIndex(of: "-") else { return nil }
        let a = spec[..<dash].trimmingCharacters(in: .whitespaces), b = spec[spec.index(after: dash)...].trimmingCharacters(in: .whitespaces)
        if a.isEmpty && b.isEmpty { return nil }
        guard a.isEmpty || Int64(a) != nil, b.isEmpty || Int64(b) != nil else { return nil }
        return (Int64(a), Int64(b))
    }

    /// What encodeURIComponent leaves as it is (a header is ASCII).
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    private static func httpDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "GMT")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return f.string(from: date)
    }

    // ---------- answers

    /// The task's whole answer, unless WebKit stopped it; on the main thread.
    private func respond(_ task: WKURLSchemeTask, _ status: Int, headers: [String: String] = [:], body: Data) {
        guard live.remove(ObjectIdentifier(task)) != nil, let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }

    private func respond(_ task: WKURLSchemeTask, _ status: Int, text: String) {
        respond(task, status, headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data(text.utf8))
    }

    /// By extension, as the server's (core/filetypes.ts contentType), plus what the bundle has.
    static func type(_ name: String) -> String {
        types[(name as NSString).pathExtension.lowercased()] ?? "application/octet-stream"
    }

    private static let types: [String: String] = [
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
        "svg": "image/svg+xml", "pdf": "application/pdf", "heic": "image/heic", "md": "text/plain; charset=utf-8",
        "txt": "text/plain; charset=utf-8", "mp3": "audio/mpeg", "m4a": "audio/mp4", "m4b": "audio/mp4", "mp4": "video/mp4",
        "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "json": "application/json",
        "webmanifest": "application/manifest+json", "ico": "image/x-icon", "woff": "font/woff", "woff2": "font/woff2",
        "ttf": "font/ttf", "otf": "font/otf", "map": "application/json", "wasm": "application/wasm", "avif": "image/avif",
        "bmp": "image/bmp", "heif": "image/heif", "aac": "audio/aac", "wav": "audio/wav", "ogg": "audio/ogg", "oga": "audio/ogg",
        "opus": "audio/ogg", "flac": "audio/flac", "m4v": "video/mp4", "mov": "video/quicktime", "webm": "video/webm",
        "ogv": "video/ogg", "csv": "text/csv; charset=utf-8", "epub": "application/epub+zip",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]
}
