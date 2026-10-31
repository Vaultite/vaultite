import AVFoundation
import MediaPlayer
import UIKit

/// The page's audio (plugins/core/player/native.ts) played here instead of in the page: it plays on when iOS ends the
/// page or the page reloads, buffers well ahead on a weak signal, starts again after a dropped connection, and owns the
/// lock screen. A kept file (Downloads) plays from the phone. All of it on the main thread.
final class Audio: NSObject {
    static let shared = Audio()
    /// Tells the page what changed (AppViewController sends it as the event `vaultite:audio`).
    var tell: (([String: Any]) -> Void)?

    private let player = AVPlayer()
    private var path: String?
    /// The note it was started in, for the page to go back to.
    private var from: String?
    private var remote: URL?
    private var server: Servers.Server?
    private var title = "", artist = "", album = ""
    private var chapters: [(t: Double, title: String)] = []
    private var art: MPMediaItemArtwork?
    private var artURL: String?
    /// Playing as far as the user knows: a stall or a dropped connection doesn't change it, a pause does.
    private var wanted = false
    private var rate: Float = 1
    private var ended = false
    private var failed: String?
    private var tries = 0
    private var lastT: Double = 0
    private var pendingSeek: Double?
    private var itemObservers: [NSKeyValueObservation] = []
    private var statusObserver: NSKeyValueObservation?
    private var saved = Date.distantPast
    private var stuckSince: Date?
    private var shownChapter = -2

    private override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = true
        statusObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.send("status") }
        }
        player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main) { [weak self] _ in self?.each() }
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, (n.object as? AVPlayerItem) === self.player.currentItem else { return }
            self.ended = true
            self.wanted = false
            self.save(done: true)
            self.send("ended")
        }
        nc.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, (n.object as? AVPlayerItem) === self.player.currentItem else { return }
            self.recover()
        }
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            let opts = AVAudioSession.InterruptionOptions(rawValue: n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            if opts.contains(.shouldResume) && self.wanted { self.player.play() }
        }
        // Headphones out: it stops (AVPlayer pauses itself), as every player does.
        nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
            guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self?.pause()
        }
        commands()
    }

    // ---------- what the page asks

    /// Ready `path` from `url` (its server's address; a kept copy plays instead) at `t`, and what to call it. The same
    /// file already loaded is kept as it is (a reloaded page taking it back).
    func load(path: String, url: URL, from: String?, t: Double?, rate: Float, title: String, artist: String, album: String, artwork: String?, chapters: [(Double, String)]) {
        self.rate = rate > 0 ? rate : 1
        player.defaultRate = self.rate
        describe(title: title, artist: artist, album: album, artwork: artwork, chapters: chapters)
        if self.path == path, player.currentItem != nil { return }
        if self.path != nil { save() }
        self.path = path
        self.from = from
        remote = url
        server = Servers.of(url)
        ended = false
        failed = nil
        tries = 0
        wanted = false
        lastT = t ?? 0
        start(at: t)
    }

    func play() {
        guard path != nil else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        if ended { ended = false; seek(0) }
        if failed != nil || player.currentItem == nil { start(at: lastT) }
        wanted = true
        player.play()
        send("play")
    }

    func pause() {
        guard path != nil else { return }
        wanted = false
        player.pause()
        save()
        send("pause")
    }

    func seek(_ t: Double) {
        guard path != nil else { return }
        lastT = max(0, t)
        ended = false
        if player.currentItem?.status != .readyToPlay { pendingSeek = lastT; return send("seeked") }
        player.seek(to: CMTime(seconds: lastT, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async { self?.nowPlaying(); self?.send("seeked") }
        }
    }

    func setRate(_ r: Float) {
        guard r > 0 else { return }
        rate = r
        player.defaultRate = r
        if player.rate > 0 { player.rate = r }
        send("rate")
    }

    func describe(title: String, artist: String, album: String, artwork: String?, chapters: [(Double, String)]) {
        self.title = title
        self.artist = artist
        self.album = album
        self.chapters = chapters.map { (t: $0.0, title: $0.1) }.sorted { $0.t < $1.t }
        shownChapter = -2
        if artwork != artURL {
            artURL = artwork
            art = nil
            if let a = artwork, let u = URL(string: a) {
                URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
                    guard let data, let image = UIImage(data: data) else { return }
                    DispatchQueue.main.async {
                        guard self?.artURL == a else { return }
                        self?.art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                        self?.nowPlaying()
                    }
                }.resume()
            }
        }
        MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled = !self.chapters.isEmpty
        MPRemoteCommandCenter.shared().previousTrackCommand.isEnabled = !self.chapters.isEmpty
        nowPlaying()
    }

    /// Done with it (the mini player's ✕): the place kept, the lock screen cleared, other apps' sound back.
    func stop() {
        guard path != nil else { return }
        wanted = false
        player.pause()
        save()
        player.replaceCurrentItem(with: nil)
        itemObservers = []
        path = nil
        from = nil
        sleepUntil = nil
        sleepChapter = nil
        send("stop")
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// A voice note is about to record: it stops, and plays on once the note is done if it was playing.
    private var heldForRecording = false
    func holdForRecording() { if wanted { heldForRecording = true; pause() } }
    func resumeAfterRecording() { if heldForRecording { heldForRecording = false; play() } }

    /// The sleep timer (the page's, kept here as the page may sleep too): stops at `until` (ms), or at the chapter's end.
    private var sleepUntil: Date?
    private var sleepChapter: Int?
    func sleep(until: Double?, chapter: Bool) {
        sleepUntil = until.map { Date(timeIntervalSince1970: $0 / 1000) }
        sleepChapter = chapter ? chapterIndex(now()) : nil
    }

    func state() -> [String: Any] {
        var s: [String: Any] = ["rate": rate, "paused": !wanted, "ended": ended,
                                "waiting": wanted && player.timeControlStatus != .playing]
        guard let path else { return s }
        s["path"] = path
        s["t"] = now()
        if let from { s["from"] = from }
        if let d = duration() { s["d"] = d }
        if let f = failed { s["error"] = f }
        return s
    }

    // ---------- underneath

    /// The item for the file, from the phone when it's kept, at `t` once it's ready.
    private func start(at t: Double?) {
        guard let path, let remote else { return }
        let url = Downloads.shared.file(for: path) ?? remote
        let item = AVPlayerItem(url: url)
        // Low-bitrate speech is a few MB an hour: minutes ahead ride out a dead zone on a walk.
        item.preferredForwardBufferDuration = 600
        pendingSeek = (t ?? 0) > 0 ? t : nil
        itemObservers = [item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.itemStatus(item) }
        }]
        player.replaceCurrentItem(with: item)
    }

    private func itemStatus(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            failed = nil
            if let t = pendingSeek {
                pendingSeek = nil
                player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                    DispatchQueue.main.async { self?.send("loaded") }
                }
            } else { send("loaded") }
            nowPlaying()
        case .failed: recover()
        default: break
        }
    }

    /// A dropped connection or a file that didn't load: again where it was, sooner first, while it should play.
    private func recover() {
        lastT = now()
        guard wanted, tries < 20 else {
            failed = player.currentItem?.error?.localizedDescription ?? "It couldn't be played"
            wanted = false
            return send("error")
        }
        let wait = min(30, pow(2, Double(tries)))
        tries += 1
        send("waiting")
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self, self.wanted, self.path != nil else { return }
            self.start(at: self.lastT)
            self.player.play()
        }
    }

    /// Each second: the lock screen's time and chapter, the place kept now and then, and a stall that won't end.
    private func each() {
        guard path != nil else { return }
        let t = now()
        if player.timeControlStatus == .playing {
            if t != lastT { tries = 0 }
            lastT = t
            stuckSince = nil
        } else if wanted && player.timeControlStatus == .waitingToPlayAtSpecifiedRate {
            if stuckSince == nil { stuckSince = Date() }
            if let s = stuckSince, Date().timeIntervalSince(s) > 20 { stuckSince = nil; recover() }
        }
        if let u = sleepUntil, Date() >= u { sleepUntil = nil; pause() }
        if let c = sleepChapter, wanted, chapterIndex(t) != c {
            sleepChapter = nil
            pause()
            let i = chapterIndex(t)
            if i >= 0 { seek(chapters[i].t) }
        }
        if chapterIndex(t) != shownChapter { nowPlaying() }
        if wanted && Date().timeIntervalSince(saved) > 30 { save() }
    }

    private func now() -> Double {
        let t = player.currentTime().seconds
        return pendingSeek ?? (t.isFinite && player.currentItem?.status == .readyToPlay ? t : lastT)
    }

    private func duration() -> Double? {
        let d = player.currentItem?.duration.seconds ?? .nan
        return d.isFinite && d > 0 ? d : nil
    }

    private func chapterIndex(_ t: Double) -> Int { chapters.lastIndex { $0.t <= t + 0.25 } ?? -1 }

    /// The lock screen: the chapter as the title with the book under it, else the file's own.
    private func nowPlaying() {
        guard path != nil else { return }
        let t = now(), i = chapterIndex(t)
        shownChapter = i
        let chapter = i >= 0 ? chapters[i].title : nil
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: chapter ?? title,
            MPMediaItemPropertyArtist: chapter != nil ? title : artist,
            MPMediaItemPropertyAlbumTitle: chapter != nil ? artist : album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: t,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? Double(rate) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(rate),
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let d = duration() { info[MPMediaItemPropertyPlaybackDuration] = d }
        if let art { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = wanted ? .playing : .paused
    }

    private func commands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.wanted { self.pause() } else { self.play() }
            return .success
        }
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.addTarget { [weak self] e in
            guard let self else { return .commandFailed }
            self.seek(max(0, self.now() - ((e as? MPSkipIntervalCommandEvent)?.interval ?? 15)))
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [30]
        c.skipForwardCommand.addTarget { [weak self] e in
            guard let self else { return .commandFailed }
            self.seek(min(self.duration() ?? .infinity, self.now() + ((e as? MPSkipIntervalCommandEvent)?.interval ?? 30)))
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(e.positionTime)
            return .success
        }
        // (headphones' double and triple press: the next and previous chapter)
        c.nextTrackCommand.addTarget { [weak self] _ in
            guard let self, !self.chapters.isEmpty else { return .noSuchContent }
            let i = self.chapterIndex(self.now())
            if i + 1 < self.chapters.count { self.seek(self.chapters[i + 1].t) }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self, !self.chapters.isEmpty else { return .noSuchContent }
            let t = self.now(), i = self.chapterIndex(t)
            self.seek(i > 0 && t - self.chapters[i].t < 3 ? self.chapters[i - 1].t : max(0, i >= 0 ? self.chapters[i].t : 0))
            return .success
        }
        c.nextTrackCommand.isEnabled = false
        c.previousTrackCommand.isEnabled = false
    }

    /// Where it stopped, to the server it came from (the page may be gone); kept for the page when that fails.
    private func save(done: Bool = false) {
        guard let path, let d = duration(), d >= 60 else { return }
        saved = Date()
        let t = done ? d : now()
        var body: [String: Any] = ["path": path, "t": t, "d": d]
        if done { body["done"] = true }
        let to = server
        Task {
            do { _ = try await Servers.call("PUT", "player/places", body, to: to) }
            catch { Downloads.shared.setPlace(["path": path, "t": t, "d": d, "at": Date().timeIntervalSince1970 * 1000]) }
        }
    }

    private func send(_ type: String) {
        var s = state()
        s["type"] = type
        tell?(s)
        if type != "status" { nowPlaying() } else { MPNowPlayingInfoCenter.default().playbackState = wanted ? .playing : .paused }
    }
}
