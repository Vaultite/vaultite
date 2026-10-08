import Foundation
import Capacitor
import WebKit

/// The shell's side of the bridge (the page's: web/src/core/phoneapp.ts). The web view starts on the first screen
/// (web/phone.html, from the app's own files), which opens a server's app in its place; every page it loads gets this
/// plugin, so the app can come back to the first screen ("Switch server…"), and so the tab list can show a picture of
/// each tab (`snapshot`), so a touch can be answered with a tap (`haptic`), and so it runs what a widget asked (`pending`).
///
/// Navigation: Capacitor sends any page that isn't the app's own to Safari. The servers in the list are the app's own
/// too (`shouldOverrideLoad`); links elsewhere still open in Safari.
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

    /// A picture of what the page shows now (the system's own, as the screen looks: web/src/core/tabShots.ts keeps one
    /// per tab for the phone's tab list). `x`, `y`, `width`, `height`: the part to take, in the page's CSS pixels;
    /// `scaled`: how wide the picture is, in points. A JPEG, as a data URL.
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

    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, Servers.knows(url) else { return nil }
        return false // allowed, in the app
    }
}
