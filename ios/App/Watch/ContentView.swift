import SwiftUI

/// Two pages, one above the other: the microphone, then the Inbox. The watch face's complication opens it recording.
struct ContentView: View {
    @StateObject private var link = PhoneLink.shared
    @StateObject private var recorder = Recorder()

    @State private var page = 0

    var body: some View {
        TabView(selection: $page) {
            MicView(recorder: recorder, link: link).tag(0)
            NavigationStack { InboxView(link: link) }.tag(1)
        }
        .tabViewStyle(.verticalPage)
        // The complication (WatchWidgets/): straight to recording.
        .onOpenURL { url in
            guard url.host == "record" else { return }
            page = 0
            if !recorder.recording { Task { await recorder.start() } }
        }
    }
}

struct MicView: View {
    @ObservedObject var recorder: Recorder
    @ObservedObject var link: PhoneLink

    var body: some View {
        VStack(spacing: 8) {
            Button { Task { await recorder.toggle() } } label: {
                ZStack {
                    Circle().fill(recorder.recording ? Color.red : Color.teal)
                    Image(systemName: recorder.recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 112, height: 112)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(recorder.recording ? "Stop and send" : "Record a voice note")

            if let started = recorder.started {
                Text(timerInterval: started...Date.distantFuture, countsDown: false)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else if let problem = recorder.problem {
                Text(problem).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            } else if let note = link.notes.first {
                NoteLine(note: note)
            } else {
                Text("Tap to say something").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
    }
}

/// The last voice note's fate, in a line.
struct NoteLine: View {
    let note: PhoneLink.Note

    var body: some View {
        switch note.state {
        case .sending:
            Label("Sending to your iPhone", systemImage: "iphone.radiowaves.left.and.right")
                .font(.footnote).foregroundStyle(.secondary)
        case let .saved(text):
            VStack(spacing: 2) {
                Label(note.dispatched ? "Sent to the front door" : "In your inbox", systemImage: "checkmark.circle.fill")
                    .font(.footnote).foregroundStyle(.green)
                Text(text).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        case let .failed(why):
            Label(why, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote).foregroundStyle(.red).lineLimit(3)
        }
    }
}

struct InboxView: View {
    @ObservedObject var link: PhoneLink

    var body: some View {
        List {
            if let problem = link.problem {
                Text(problem).font(.footnote).foregroundStyle(.red)
            }
            if link.events.isEmpty && link.problem == nil && !link.loading {
                Text("Nothing new").foregroundStyle(.secondary)
            }
            ForEach(link.events) { e in
                NavigationLink(value: e.id) { EventRow(event: e) }
            }
        }
        .navigationTitle(link.unread > 0 ? "Inbox (\(link.unread))" : "Inbox")
        .navigationDestination(for: String.self) { id in EventView(link: link, id: id) }
        .overlay { if link.loading && link.events.isEmpty { ProgressView() } }
        .task { await link.refresh() }
        .refreshable { await link.refresh() }
    }
}

struct EventRow: View {
    let event: PhoneLink.Event

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: icon).foregroundStyle(tint).font(.footnote).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(.footnote.weight(event.read ? .regular : .semibold)).lineLimit(2)
                if !event.body.isEmpty { Text(event.body).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
                Text(event.t, format: .relative(presentation: .named)).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .opacity(event.read ? 0.6 : 1)
    }

    private var icon: String {
        switch event.kind {
        case "waiting": "questionmark.bubble.fill"
        case "done": "checkmark.circle.fill"
        case "error": "exclamationmark.circle.fill"
        default: "bell.fill"
        }
    }

    private var tint: Color {
        switch event.kind {
        case "waiting": .orange
        case "done": .green
        case "error": .red
        default: .secondary
        }
    }
}

/// One event, with its buttons: Approve and Deny for a permission, else Mark read.
struct EventView: View {
    @ObservedObject var link: PhoneLink
    let id: String
    @State private var busy = false
    @State private var said: (ok: Bool, text: String)?

    var body: some View {
        ScrollView {
            if let e = link.events.first(where: { $0.id == id }) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(e.title).font(.headline)
                    if !e.body.isEmpty { Text(e.body).font(.footnote) }
                    Text(e.t, format: .relative(presentation: .named)).font(.caption2).foregroundStyle(.secondary)
                    if let said {
                        Text(said.text).font(.footnote).foregroundStyle(said.ok ? .green : .red)
                    }
                    if e.approvable {
                        Button { act("approve") } label: { Label("Approve", systemImage: "checkmark") }
                            .tint(.green).disabled(busy)
                        Button(role: .destructive) { act("deny") } label: { Label("Deny", systemImage: "xmark") }
                            .disabled(busy)
                    } else if !e.read {
                        Button { act("read") } label: { Label("Mark read", systemImage: "envelope.open") }
                            .disabled(busy)
                    }
                }
            }
        }
    }

    private func act(_ answer: String) {
        busy = true
        Task {
            said = await link.answer(id, answer)
            busy = false
        }
    }
}
