import SwiftUI
import WidgetKit

/// The iPhone's widgets and controls: shortcuts (Actions.swift), today's routines (Routines.swift) and agents waiting
/// (Agents.swift). They reach the server the app opened last through the app group.
@main
struct VaultiteWidgets: WidgetBundle {
    var body: some Widget {
        ActionWidget()
        ActionsWidget()
        RoutinesWidget()
        AgentsWidget()
        VoiceNoteControl()
        ActionControl()
    }
}

/// The widgets' push token, told to the server: it pushes when what they show changes (a routine ticked, an agent
/// waiting), so they don't wait for their next refresh.
struct WidgetPushes: WidgetPushHandler {
    func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
        Servers.widgetToken = pushInfo.token.map { String(format: "%02x", $0) }.joined()
        Task { await Servers.tellWidgets() }
    }
}
