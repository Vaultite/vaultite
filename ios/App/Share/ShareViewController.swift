import UIKit
import UniformTypeIdentifiers

/// Vaultite in the share sheet. A web page is clipped into the vault (POST /api/clip: from Safari with its HTML as
/// shown, so a page you're logged in to clips too; from another app its address, which the server fetches). Other
/// text goes to the inbox (POST /api/inbox); photos and files too, saved in the vault's attachments folder and embedded
/// in that inbox note under the text shared with them (the op file.upload). It's sent to the server the app opened
/// last (Shared/Servers.swift), over the tailnet like the app.
class ShareViewController: UIViewController {
    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()

    enum Shared {
        case page(url: String, html: String?)
        case text(String)
        /// Each a copy in the extension's temporary folder (sent from there, so a big one is never all in memory).
        case files([(name: String, file: URL)], text: String)
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.2)
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14
        label.font = .preferredFont(forTextStyle: .body)
        label.numberOfLines = 0
        label.textAlignment = .center
        label.text = "Saving to Vaultite"
        spinner.startAnimating()
        let stack = UIStackView(arrangedSubviews: [spinner, label])
        stack.axis = .vertical
        stack.spacing = 10
        stack.alignment = .center
        for v in [card, stack] { v.translatesAutoresizingMaskIntoConstraints = false }
        view.addSubview(card)
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 280),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])
        Task { await save() }
    }

    private func save() async {
        do {
            guard let server = Servers.current, let base = URL(string: server.url) else {
                throw Failure("Open Vaultite and add your server first")
            }
            let saved: String
            switch try await shared() {
            case let .page(url, html):
                var body: [String: Any] = ["url": url, "from": "iPhone"]
                if let html { body["html"] = html }
                let answer = try await post(base.appendingPathComponent("api/clip"), body)
                saved = answer["existing"] as? Bool == true ? "Already in the vault" : "Saved to \(folder(answer["path"]))"
            case let .text(text):
                let title = String(text.split(whereSeparator: \.isNewline).first ?? "Shared text").prefix(80)
                _ = try await post(base.appendingPathComponent("api/inbox"), ["title": String(title), "body": text, "from": "iPhone"])
                saved = "Saved to the inbox"
            case let .files(files, text):
                let named = files.count == 1 ? files[0].name : "\(files.count) files"
                let title = String(text.split(whereSeparator: \.isNewline).first.map(String.init) ?? named).prefix(80)
                let note = try await post(base.appendingPathComponent("api/inbox"), ["title": String(title), "body": text, "from": "iPhone"])
                guard let id = note["id"] as? String else { throw Failure("The server didn't say where the note went") }
                defer { for f in files { try? FileManager.default.removeItem(at: f.file) } }
                for (i, f) in files.enumerated() {
                    label.text = files.count == 1 ? "Saving to Vaultite" : "Saving \(i + 1) of \(files.count)"
                    try await upload(base.appendingPathComponent("api/ops/file.upload"), f.file, ["name": f.name, "note": "\(id).md"])
                }
                saved = "Saved to the inbox"
            }
            done(saved, after: 0.8)
        } catch {
            done(Servers.say(error), after: 2.5)
        }
    }

    /// What was shared: Safari's page (its preprocessing results), photos and files (with any text), an address, or
    /// text (an address in it is a page).
    private func shared() async throws -> Shared {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
            let item = try await p.loadItem(forTypeIdentifier: UTType.propertyList.identifier)
            if let results = (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any],
               let url = results["url"] as? String {
                return .page(url: url, html: results["html"] as? String)
            }
        }
        var files: [(name: String, file: URL)] = []
        for p in providers {
            if let f = try await file(p) { files.append(f) }
        }
        if !files.isEmpty {
            // The text shared with them: the post's comment, or a text attachment beside them.
            var text = items.compactMap { $0.attributedContentText?.string }.joined(separator: "\n")
            for p in providers where text.isEmpty && p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                text = (try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String) ?? ""
            }
            return .files(files, text: text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, url.scheme?.hasPrefix("http") == true {
                return .page(url: url.absoluteString, html: nil)
            }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if let url = URL(string: t), url.scheme?.hasPrefix("http") == true, !t.contains(" ") { return .page(url: t, html: nil) }
                if !t.isEmpty { return .text(t) }
            }
        }
        throw Failure("Nothing to save: only pages, links, text, photos and files")
    }

    /// A photo or file an attachment holds (a file, bytes or an image), copied to the temporary folder, with its name;
    /// nil for a page, a link or text.
    private func file(_ p: NSItemProvider) async throws -> (name: String, file: URL)? {
        let skip: [UTType] = [.url, .text, .propertyList]
        guard let type = p.registeredTypeIdentifiers.compactMap({ UTType($0) }).first(where: { t in
            (t.conforms(to: .image) || t.conforms(to: .data)) && !skip.contains(where: { t.conforms(to: $0) })
        }) else { return nil }
        let item = try await p.loadItem(forTypeIdentifier: type.identifier)
        let ext = type.preferredFilenameExtension.map { ".\($0)" } ?? ""
        let stem = p.suggestedName ?? (type.conforms(to: .image) ? "Shared image" : "Shared file")
        let to = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        if let url = item as? URL, url.isFileURL {
            let open = url.startAccessingSecurityScopedResource()
            defer { if open { url.stopAccessingSecurityScopedResource() } }
            try FileManager.default.copyItem(at: url, to: to)
            return (url.lastPathComponent, to)
        }
        if let data = item as? Data {
            try data.write(to: to)
            return ((stem as NSString).pathExtension.isEmpty ? stem + ext : stem, to)
        }
        if let image = item as? UIImage, let data = image.jpegData(compressionQuality: 0.9) {
            try data.write(to: to)
            return ("\(stem).jpg", to)
        }
        return nil
    }

    /// POST `fields` and the file's bytes as `data` (base64), the JSON written to a file a chunk at a time and sent
    /// from it: a video is never all in memory, which a share extension doesn't have much of.
    private func upload(_ url: URL, _ file: URL, _ fields: [String: String]) async throws {
        let body = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: body) }
        FileManager.default.createFile(atPath: body.path, contents: nil)
        let out = try FileHandle(forWritingTo: body), from = try FileHandle(forReadingFrom: file)
        defer { try? out.close(); try? from.close() }
        var head = try JSONSerialization.data(withJSONObject: fields)
        head.removeLast() // its closing brace: data follows
        try out.write(contentsOf: head + Data(#","data":""#.utf8))
        // (a multiple of 3 bytes a chunk, so the pieces of base64 join as one)
        while let chunk = try from.read(upToCount: 3 << 18), !chunk.isEmpty {
            try out.write(contentsOf: chunk.base64EncodedData())
        }
        try out.write(contentsOf: Data(#""}"#.utf8))
        try out.close()
        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await URLSession.shared.upload(for: request, fromFile: body)
        let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) { throw Failure(answer["error"] as? String ?? "The server answered \(status)") }
    }

    private func post(_ url: URL, _ body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: url, timeoutInterval: 45)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) { throw Failure(answer["error"] as? String ?? "The server answered \(status)") }
        return answer
    }

    private func folder(_ path: Any?) -> String {
        let p = path as? String ?? ""
        return p.contains("/") ? String(p[..<p.lastIndex(of: "/")!]) : "the vault"
    }

    private func done(_ text: String, after: Double) {
        spinner.stopAnimating()
        spinner.isHidden = true
        label.text = text
        DispatchQueue.main.asyncAfter(deadline: .now() + after) {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
