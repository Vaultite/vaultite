import SwiftUI
import UserNotifications
import WatchKit

/// Vaultite on the watch: no keyboard. A microphone (a voice note, transcribed on the phone, into the Inbox and to the
/// front-door agent when the server has one) and the Inbox's events, answered with buttons. Everything goes through
/// the phone (PhoneLink.swift).
@main
struct VaultiteWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchDelegate

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

/// The phone's notifications, on the watch: the same buttons as the phone's (App/Push.swift's categories), answered
/// through the phone.
final class WatchDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        PhoneLink.shared.start()
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "permission", actions: [
                UNNotificationAction(identifier: "approve", title: "Approve", options: [.authenticationRequired]),
                UNNotificationAction(identifier: "deny", title: "Deny", options: [.destructive]),
            ], intentIdentifiers: []),
            UNNotificationCategory(identifier: "event", actions: [
                UNNotificationAction(identifier: "read", title: "Mark read", options: []),
            ], intentIdentifiers: []),
        ])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["event"] as? String,
              ["approve", "deny", "read"].contains(response.actionIdentifier) else { return }
        _ = await PhoneLink.shared.answer(id, response.actionIdentifier)
    }
}
