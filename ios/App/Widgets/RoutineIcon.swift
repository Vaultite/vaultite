import SwiftUI
import UIKit

/// An icon as the vault names it (`icon:`): an emoji as it is, a Lucide name as the SF Symbol closest to it (Lucide's
/// own aren't on the phone), else the name's first letter.
struct RoutineIcon: View {
    let icon: String
    let name: String

    var body: some View {
        if Self.isEmoji(icon) {
            Text(icon)
        } else if let symbol = Self.symbol(icon) {
            Image(systemName: symbol)
        } else {
            Text(name.prefix(1).uppercased()).fontWeight(.semibold)
        }
    }

    static func isEmoji(_ s: String) -> Bool {
        guard let c = s.first, s.count == 1 else { return false }
        return c.unicodeScalars.contains { $0.properties.isEmojiPresentation || ($0.properties.isEmoji && $0.value > 0x238C) }
    }

    /// Lucide's names whose SF Symbol is called something else; the rest are tried as they are (heart, moon, star).
    private static let symbols: [String: String] = [
        "activity": "waveform.path.ecg", "apple": "fork.knife", "bed": "bed.double", "bed-double": "bed.double", "bike": "bicycle",
        "book": "book", "book-open": "book", "brain": "brain", "briefcase": "briefcase", "brush": "paintbrush",
        "calendar": "calendar", "calendar-check": "calendar.badge.checkmark", "calendar-days": "calendar", "check": "checkmark",
        "circle-check": "checkmark.circle", "code": "chevron.left.forwardslash.chevron.right", "coffee": "cup.and.saucer",
        "compass": "safari", "cpu": "cpu", "droplet": "drop", "dumbbell": "dumbbell", "flame": "flame", "flower": "camera.macro",
        "footprints": "figure.walk", "glass-water": "waterbottle", "graduation-cap": "graduationcap", "guitar": "guitars",
        "heart-pulse": "heart.text.square", "home": "house", "house": "house", "languages": "character.book.closed",
        "leaf": "leaf", "lightbulb": "lightbulb", "list-checks": "checklist", "map": "map", "mountain": "mountain.2",
        "mountain-snow": "mountain.2", "music": "music.note", "music-2": "music.note", "music-3": "music.note",
        "music-4": "music.quarternote.3", "notebook": "book.closed", "notebook-pen": "book.closed", "notebook-text": "book.closed",
        "paintbrush": "paintbrush", "palette": "paintpalette", "pen": "pencil", "pen-line": "pencil", "pencil": "pencil",
        "person-standing": "figure.stand", "piano": "pianokeys", "pill": "pills", "plane": "airplane", "salad": "fork.knife",
        "smile": "face.smiling", "sparkles": "sparkles", "sprout": "leaf", "sun": "sun.max", "target": "target",
        "timer": "timer", "trophy": "trophy", "user": "person", "users": "person.2", "utensils": "fork.knife",
        "wallet": "creditcard", "waves": "water.waves",
    ]

    static func symbol(_ icon: String) -> String? {
        let n = icon.lowercased()
        for s in [symbols[n], n].compactMap({ $0 }) where !s.isEmpty && UIImage(systemName: s) != nil { return s }
        return nil
    }
}
