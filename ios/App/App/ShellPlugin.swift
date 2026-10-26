import Foundation
import Capacitor
import WebKit

/// The shell's side of the bridge (the page's: web/src/core/phoneapp.ts), given to every page the web view loads.
/// Capacitor sends pages that aren't the app's own to Safari; listed servers are its own too (`shouldOverrideLoad`).
@objc(ShellPlugin)
public class ShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellPlugin"
    public let jsName = "Shell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "servers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setServers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "launcher", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePlaces", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "health", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHealth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resendHealth", returnType: CAPPluginReturnPromise),
    ]

    /// What a widget or a shortcut asked for (AppViewController): `command` or `open`, until the page takes it.
    var waiting: [String: String]?

    @objc func servers(_ call: CAPPluginCall) {
        var answer: [String: Any] = ["servers": Servers.list.map { ["url": $0.url, "name": $0.name] }]
        if let last = Servers.last { answer["last"] = last }
        call.resolve(answer)
    }

    @objc func setServers(_ call: CAPPluginCall) {
        let given = call.getArray("servers", JSObject.self) ?? []
        Servers.list = given.compactMap { s in
            guard let url = s["url"] as? String, let name = s["name"] as? String else { return nil }
            return Servers.Server(url: url, name: name)
        }
        call.resolve()
    }

    /// Whether a Vaultite server answers at `url`: its web app's manifest names it.
    @objc func probe(_ call: CAPPluginCall) {
        guard let base = call.getString("url"), let url = URL(string: base + "/manifest.webmanifest") else {
            return call.reject("not a web address")
        }
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { return call.resolve(["ok": false, "error": Servers.say(error)]) }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let named = data.map { String(decoding: $0, as: UTF8.self).contains("Vaultite") } ?? false
            if status == 200 && named { return call.resolve(["ok": true]) }
            call.resolve(["ok": false, "error": status == 200 ? "That isn't a Vaultite server" : "It answered \(status)"])
        }.resume()
    }

    /// Load a server's app in place of the page asking (one of the list's), remembered as the last one.
    @objc func open(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address), Servers.knows(url) else {
            return call.reject("not a server in the list")
        }
        Servers.last = address
        Push.shared.tell() // this server sends the notifications now
        DispatchQueue.main.async {
            _ = self.webView?.load(URLRequest(url: url))
            call.resolve()
        }
    }

    /// Back to the first screen, which this time doesn't open the last server by itself.
    @objc func launcher(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let bridge = self.bridge,
                  let url = URL(string: bridge.config.localURL.absoluteString + "/phone.html?pick") else { return call.reject("no first screen") }
            _ = self.webView?.load(URLRequest(url: url))
            call.resolve()
        }
    }

    /// A picture of what the page shows now, as the screen looks (tabShots.ts keeps one per tab for the tab list).
    /// `x`, `y`, `width`, `height`: the part, in CSS pixels; `scaled`: its width in points. A JPEG data URL.
    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.webView else { return call.reject("no web view") }
            let config = WKSnapshotConfiguration()
            if let w = call.getDouble("width"), let h = call.getDouble("height"), w > 0, h > 0 {
                // The page's CSS pixels are the web view's points (no zoom), offset by the content inset (none: "never").
                config.rect = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0, width: w, height: h)
            }
            if let scaled = call.getDouble("scaled"), scaled > 0 { config.snapshotWidth = NSNumber(value: scaled) }
            // As it's drawn now: no waiting for the next frame, so it's quick and never catches a transition.
            config.afterScreenUpdates = false
            webView.takeSnapshot(with: config) { image, error in
                guard let image, let data = image.jpegData(compressionQuality: CGFloat(call.getDouble("quality") ?? 0.7)) else {
                    return call.reject(error?.localizedDescription ?? "no picture")
                }
                call.resolve(["url": "data:image/jpeg;base64," + data.base64EncodedString()])
            }
        }
    }

    /// A tap from the Taptic Engine (web/src/core/haptics.ts): `weight` is an impact style, a notification or "selection".
    @objc func haptic(_ call: CAPPluginCall) {
        let weight = call.getString("weight") ?? "light"
        DispatchQueue.main.async {
            switch weight {
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            default:
                let styles: [String: UIImpactFeedbackGenerator.FeedbackStyle] = ["medium": .medium, "heavy": .heavy, "soft": .soft, "rigid": .rigid]
                UIImpactFeedbackGenerator(style: styles[weight] ?? .light).impactOccurred()
            }
            call.resolve()
        }
    }

    /// What's waiting (phoneapp.ts takeLinks), taken once.
    @objc func pending(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let p = self.waiting
            self.waiting = nil
            call.resolve(p ?? [:])
        }
    }

    /// Keep a file on this iPhone (Downloads.swift): `url` its bytes on a server in the list, `path` its vault path.
    @objc func download(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address), Servers.knows(url),
              let path = call.getString("path") else { return call.reject("not a file on a server in the list") }
        let server = url.scheme.map { "\($0)://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")" } ?? ""
        Downloads.shared.start(url: url, path: path, title: call.getString("title") ?? (path as NSString).lastPathComponent, server: server)
        call.resolve()
    }

    /// What's kept and what's on its way: `file` is where it is on the phone, `got` and `size` how far it is.
    @objc func downloads(_ call: CAPPluginCall) {
        let items: [[String: Any]] = Downloads.shared.list().map { it in
            var o: [String: Any] = ["path": it.path, "title": it.title, "server": it.server, "size": it.size, "got": it.got, "done": it.done]
            if let f = it.file { o["file"] = f }
            if let e = it.error { o["error"] = e }
            return o
        }
        call.resolve(["items": items])
    }

    @objc func removeDownload(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { return call.reject("no path") }
        Downloads.shared.remove(path: path)
        call.resolve()
    }

    /// Where playback stopped on the first screen (offline), until the server's page takes it.
    @objc func setPlace(_ call: CAPPluginCall) {
        Downloads.shared.setPlace(call.options as? [String: Any] ?? [:])
        call.resolve()
    }

    @objc func takePlaces(_ call: CAPPluginCall) {
        call.resolve(["places": Downloads.shared.takePlaces()])
    }

    /// Apple Health for the server this page is on (Health.swift): what it's doing, and its switch. `route`: where the
    /// server takes what it reads (after /api/).
    @objc func health(_ call: CAPPluginCall) {
        guard let url = pageServer() else { return call.reject("not a server in the list") }
        Task { call.resolve(await Health.shared.status(url)) }
    }

    @objc func setHealth(_ call: CAPPluginCall) {
        guard let url = pageServer() else { return call.reject("not a server in the list") }
        let on = call.getBool("on") ?? false, route = call.getString("route") ?? ""
        if on && route.isEmpty { return call.reject("no route") }
        Task {
            do {
                try await Health.shared.set(url, on: on, route: route)
                call.resolve(await Health.shared.status(url))
            } catch { call.reject(Servers.say(error)) }
        }
    }

    @objc func resendHealth(_ call: CAPPluginCall) {
        guard let url = pageServer() else { return call.reject("not a server in the list") }
        Health.shared.resend(url)
        call.resolve()
    }

    /// The server of the list whose page asks.
    private func pageServer() -> String? {
        var url: URL?
        if Thread.isMainThread { url = webView?.url } else { DispatchQueue.main.sync { url = self.webView?.url } }
        return url.flatMap(Servers.of)?.url
    }

    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, Servers.knows(url) else { return nil }
        return false // allowed, in the app
    }
}
