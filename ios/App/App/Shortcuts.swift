import AppIntents

/// Siri, Spotlight and the Action button (Settings > Action button > Shortcut > Vaultite).
struct VaultiteShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenVaultite(.voiceNote), phrases: ["Record a voice note in \(.applicationName)", "\(.applicationName) voice note"],
                    shortTitle: "Voice note", systemImageName: "mic.fill")
        AppShortcut(intent: OpenVaultite(.newNote), phrases: ["New note in \(.applicationName)"], shortTitle: "New note", systemImageName: "square.and.pencil")
        AppShortcut(intent: OpenVaultite(.dailyNote), phrases: ["Open my daily note in \(.applicationName)"], shortTitle: "Daily note", systemImageName: "calendar")
        AppShortcut(intent: OpenVaultite(.search), phrases: ["Search \(.applicationName)"], shortTitle: "Search", systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenVaultite(.openNote), phrases: ["Open a note in \(.applicationName)"], shortTitle: "Open a note", systemImageName: "doc.text")
    }
}
