import UIKit
import UserNotifications

/// The Inbox's events as the phone's notifications (and so the watch's): the app asks to notify, registers with Apple's
/// push service and gives its token to the server it opened last (POST /api/inbox/devices; the server sends,
/// plugins/core/inbox/push.ts). A notification's buttons answer it (the op inbox.answer): Approve and Deny on an agent
/// asking permission (category "permission"), Mark read on the rest ("event"). The watch registers the same categories
/// (Watch/Notifications.swift), so its buttons are the same.
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()

    /// The buttons, by the category the server sends. Approve needs the phone unlocked (it runs something on the Mac).
    static let categories: Set<UNNotificationCategory> = [
        UNNotificationCategory(identifier: "permission", actions: [
            UNNotificationAction(identifier: "approve", title: "Approve", options: [.authenticationRequired]),
            UNNotificationAction(identifier: "deny", title: "Deny", options: [.destructive]),
        ], intentIdentifiers: []),
        UNNotificationCategory(identifier: "event", actions: [
            UNNotificationAction(identifier: "read", title: "Mark read", options: []),
        ], intentIdentifiers: []),
    ]

    private var token: String? {
        get { Servers.defaults.string(forKey: "pushToken") }
        set { Servers.defaults.set(newValue, forKey: "pushToken") }
    }

    func start(_ application: UIApplication) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(Self.categories)
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
    }

    func registered(_ deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        tell()
    }

    /// Give the token to the current server (again: a new server, a new token), and the widgets'. Quietly: an older
    /// server has no route.
    func tell() {
        Task { await Servers.tellWidgets() }
        guard let token, Servers.current != nil else { return }
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        let body: [String: Any] = ["token": token, "env": env, "topic": Bundle.main.bundleIdentifier ?? "", "name": UIDevice.current.name]
        Task { _ = try? await Servers.call("POST", "inbox/devices", body) }
    }

    /// While the app is in front, its own toasts show the event: no banner.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        UIApplication.shared.applicationState == .active ? [] : [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["event"] as? String else { return }
        let answer: String
        switch response.actionIdentifier {
        case "approve": answer = "approve"
        case "deny": answer = "deny"
        case "read": answer = "read"
        default: return // the notification itself: the app opens
        }
        do {
            _ = try await Self.answer(id, answer)
        } catch {
            Self.say("Couldn't \(answer == "read" ? "mark it read" : answer): \(Servers.say(error))")
        }
    }

    /// Answer an event on the server (the op inbox.answer): what it did, in a line.
    static func answer(_ id: String, _ answer: String) async throws -> String {
        _ = try await Servers.call("POST", "ops/inbox.answer", ["id": id, "answer": answer])
        return answer == "approve" ? "Approved" : answer == "deny" ? "Denied" : "Read"
    }

    /// A local notification: something the user asked for from a notification didn't happen.
    static func say(_ text: String) {
        let content = UNMutableNotificationContent()
        content.title = "Vaultite"
        content.body = text
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
