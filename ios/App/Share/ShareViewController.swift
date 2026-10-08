import UIKit
import UniformTypeIdentifiers

/// Vaultite in the share sheet. A web page is clipped into the vault (POST /api/clip: from Safari with its HTML as
/// shown, so a page you're logged in to clips too; from another app its address, which the server fetches). Other
/// text goes to the inbox (POST /api/inbox). It's sent to the server the app opened last (Shared/Servers.swift),
/// over the tailnet like the app.
class ShareViewController: UIViewController {
    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()

    enum Shared {
        case page(url: String, html: String?)
        case text(String)
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
            }
            done(saved, after: 0.8)
        } catch {
            done(Servers.say(error), after: 2.5)
        }
    }

    /// What was shared: Safari's page (its preprocessing results), an address, or text (an address in it is a page).
    private func shared() async throws -> Shared {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
            let item = try await p.loadItem(forTypeIdentifier: UTType.propertyList.identifier)
            if let results = (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any],
               let url = results["url"] as? String {
                return .page(url: url, html: results["html"] as? String)
            }
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
        throw Failure("Nothing to save: only pages, links and text")
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
