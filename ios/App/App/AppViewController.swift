import UIKit
import SwiftUI
import Capacitor
import WebKit

/// The app's one screen: Capacitor's web view (the first screen, then a server's app), with the Shell plugin. It also
/// does what a widget or a shortcut asks (Links): a voice note over the page, or a command for the page to run.
class AppViewController: CAPBridgeViewController {
    private let shell = ShellPlugin()
    /// Capacitor's navigation delegate, kept (the web view holds its delegate weakly).
    private var fallback: LoadFallback?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(shell)
        // A server's page that doesn't load (unreachable, or reloaded after iOS ended the page in the background) goes
        // back to the first screen, saying why, instead of a blank screen only quitting the app gets out of.
        if let webView, let local = bridge?.config.localURL {
            let fallback = LoadFallback(inner: webView.navigationDelegate) { [weak webView] failed, why in
                var to = URLComponents(url: local.appendingPathComponent("phone.html"), resolvingAgainstBaseURL: false)
                to?.queryItems = [URLQueryItem(name: "failed", value: failed), URLQueryItem(name: "why", value: why)]
                if let url = to?.url { _ = webView?.load(URLRequest(url: url)) }
            }
            webView.navigationDelegate = fallback
            self.fallback = fallback
        }
        // The system's background behind a page while it loads: no white flash in dark mode.
        webView?.isOpaque = false
        webView?.backgroundColor = .systemGroupedBackground
        webView?.scrollView.backgroundColor = .systemGroupedBackground
        NotificationCenter.default.addObserver(forName: Links.asked, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.takeLink() }
        }
        // The app switcher, a call or Control Center: the page isn't told it's inactive, so a finger's drag there would
        // never end (web/src/core/away.ts).
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.webView?.evaluateJavaScript("dispatchEvent(new Event('vaultite:away'))") }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        takeLink() // asked before this screen was there (the app started by it)
    }

    private func takeLink() {
        guard viewIfLoaded?.window != nil, let url = Links.pending else { return }
        Links.pending = nil
        switch url.host {
        case "record": record()
        case "command", "open":
            let arg = String(url.path.dropFirst()) // (decoded)
            guard !arg.isEmpty else { return }
            shell.waiting = url.host == "open" ? ["open": arg] : ["command": arg]
            // The server's page takes it now; the first screen opens the server, whose page takes it as it starts.
            webView?.evaluateJavaScript("dispatchEvent(new Event('vaultite:link'))")
        default: break
        }
    }

    private func record() {
        if presentedViewController is UIHostingController<VoiceNoteView> { return }
        presentedViewController?.dismiss(animated: false)
        let note = VoiceNote()
        let sheet = UIHostingController(rootView: VoiceNoteView(note: note))
        sheet.isModalInPresentation = true
        if let s = sheet.sheetPresentationController { s.detents = [.medium()] }
        note.close = { [weak sheet] in sheet?.dismiss(animated: true) }
        present(sheet, animated: true)
    }
}

/// Capacitor's navigation delegate with one thing more: a server's page whose load failed (not one replaced by another
/// load) calls `failed` with the server's address and why. Everything else goes to Capacitor's, as before.
final class LoadFallback: NSObject, WKNavigationDelegate {
    private let inner: WKNavigationDelegate?
    private let failed: (String, String) -> Void

    init(inner: WKNavigationDelegate?, failed: @escaping (String, String) -> Void) {
        self.inner = inner
        self.failed = failed
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        inner?.responds(to: aSelector) == true ? inner : super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        let e = error as NSError
        // (-999: another load took over; WebKit's 102: a download or a link handed to another app)
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        guard let url = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL, url.scheme == "http" || url.scheme == "https",
              let host = url.host else { return }
        let origin = "\(url.scheme!)://\(host)\(url.port.map { ":\($0)" } ?? "")"
        failed(origin, e.localizedDescription)
    }
}
