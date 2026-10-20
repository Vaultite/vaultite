import Foundation
import HealthKit
import UIKit

/// Apple Health into the vault: sleep, workouts and each day's activity, posted to the route each server's Settings page
/// named when it turned this on (ShellPlugin's health*). Its whole history first (newest days first, resumable), then
/// what's new as the Watch syncs (observer queries with background delivery, anchored queries). Anchors are per server.
final class Health {
    static let shared = Health()
    let store = HKHealthStore()
    private let runner = Runner()

    /// A server it sends to, and how far it got.
    struct Target: Codable {
        var url: String
        var route: String
        var on = true
        var anchors: [String: Data] = [:]
        /// Streams whose history has been sent once (anchored to now).
        var drained: [String] = []
        var recent = false
        /// The days' history going back: the first day sent so far, and the first day Health has.
        var daysFrom: String?
        var daysStart: String?
        var historyAt: Date?
        var sent: [String: Int] = [:]
        var last: Date?
        var error: String?
        /// What it sends has grown since (2: nights' timelines, the rings): below that, sleep and days go again once.
        var version: Int?
    }
    private static let version = 2

    /// What it's doing now, for Settings.
    private(set) var phase: String?
    private(set) var progress: Double?
    private var syncing = false
    private var stopped = false

    // MARK: what it reads

    enum Stream: String, CaseIterable { case sleep, workouts, steps, energy, exercise, resting, hrv, vo2, weight }

    /// A day's numbers: the type, how they add up, their unit and their key in the day's log.
    private static let metrics: [(Stream, HKQuantityTypeIdentifier, HKStatisticsOptions, HKUnit, String)] = [
        (.steps, .stepCount, .cumulativeSum, .count(), "steps"),
        (.energy, .activeEnergyBurned, .cumulativeSum, .kilocalorie(), "active_kcal"),
        (.exercise, .appleExerciseTime, .cumulativeSum, .minute(), "exercise_min"),
        (.resting, .restingHeartRate, .discreteAverage, .count().unitDivided(by: .minute()), "resting_hr"),
        (.hrv, .heartRateVariabilitySDNN, .discreteAverage, .secondUnit(with: .milli), "hrv_ms"),
        (.vo2, .vo2Max, .discreteAverage, HKUnit(from: "ml/kg*min"), "vo2max"),
        (.weight, .bodyMass, .mostRecent, .gramUnit(with: .kilo), "weight_kg"),
    ]
    private static let distances: [HKQuantityTypeIdentifier] = [.distanceWalkingRunning, .distanceCycling, .distanceSwimming,
        .distanceDownhillSnowSports, .distanceWheelchair, .distanceRowing, .distancePaddleSports, .distanceCrossCountrySkiing, .distanceSkatingSports]

    private func type(_ s: Stream) -> HKSampleType {
        switch s {
        case .sleep: return HKCategoryType(.sleepAnalysis)
        case .workouts: return HKWorkoutType.workoutType()
        default: return HKQuantityType(Self.metrics.first { $0.0 == s }!.1)
        }
    }

    private var readTypes: Set<HKObjectType> {
        Set(Stream.allCases.map(type) + [HKQuantityType(.heartRate), HKObjectType.activitySummaryType()] + Self.distances.map { HKQuantityType($0) })
    }

    // MARK: settings

    private var targets: [Target] {
        get { Servers.defaults.data(forKey: "health").flatMap { try? JSONDecoder().decode([Target].self, from: $0) } ?? [] }
        set { Servers.defaults.set(try? JSONEncoder().encode(newValue), forKey: "health") }
    }

    private func update(_ url: String, _ change: (inout Target) -> Void) {
        var all = targets
        guard let i = all.firstIndex(where: { $0.url == url }) else { return }
        change(&all[i])
        targets = all
    }

    func status(_ url: String) async -> [String: Any] {
        var o: [String: Any] = ["available": HKHealthStore.isHealthDataAvailable(), "syncing": syncing]
        let asked = try? await store.statusForAuthorizationRequest(toShare: [], read: readTypes)
        o["asked"] = asked == .unnecessary
        guard let t = targets.first(where: { $0.url == url }) else { o["on"] = false; return o }
        o["on"] = t.on
        o["sent"] = t.sent
        o["done"] = t.drained.count == Stream.allCases.count && t.recent
        if let last = t.last { o["last"] = ISO8601DateFormatter().string(from: last) }
        if let e = t.error { o["error"] = e }
        if syncing, let phase { o["phase"] = phase; if let progress { o["progress"] = progress } }
        return o
    }

    /// Turn it on for a server (asking Health for read access the first time) or off; on, it starts syncing.
    func set(_ url: String, on: Bool, route: String) async throws {
        if on {
            guard HKHealthStore.isHealthDataAvailable() else { throw Servers.Failure("Apple Health isn't on this device") }
            try await store.requestAuthorization(toShare: [], read: readTypes)
            var all = targets
            if let i = all.firstIndex(where: { $0.url == url }) { all[i].on = true; all[i].route = route; all[i].error = nil }
            else { all.append(Target(url: url, route: route)) }
            targets = all
            await start()
            Task { await sync() }
        } else {
            update(url) { $0.on = false }
            if !targets.contains(where: \.on) { try? await store.disableAllBackgroundDelivery() }
        }
    }

    /// Send everything again (reruns update the same logs).
    func resend(_ url: String) {
        update(url) { t in t = Target(url: t.url, route: t.route, on: t.on) }
        Task { await sync() }
    }

    // MARK: running

    private var started = false

    /// At launch (also a background one, which HealthKit makes to deliver) and when turned on: watch every type.
    func start() async {
        guard !started, targets.contains(where: \.on), HKHealthStore.isHealthDataAvailable() else { return }
        started = true
        for s in Stream.allCases {
            let t = type(s)
            try? await store.enableBackgroundDelivery(for: t, frequency: s == .sleep || s == .workouts ? .immediate : .hourly)
            store.execute(HKObserverQuery(sampleType: t, predicate: nil) { _, done, error in
                guard error == nil else { return done() }
                Task { await Health.shared.sync(); done() }
            })
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { await Health.shared.sync() }
        }
    }

    /// Send what each server that's on hasn't had; one run at a time (another asked meanwhile runs once after).
    func sync() async {
        await runner.run {
            // In the background it has a little time: when that's up it stops between posts (the anchors kept say where).
            self.stopped = false
            var task = UIBackgroundTaskIdentifier.invalid
            task = await UIApplication.shared.beginBackgroundTask(withName: "health") {
                self.stopped = true
                UIApplication.shared.endBackgroundTask(task)
                task = .invalid
            }
            self.syncing = true
            for t in self.targets where t.on {
                do {
                    try await self.send(t.url)
                    self.update(t.url) { $0.error = nil; $0.last = Date() }
                } catch {
                    // Health can't be read while the phone is locked: it waits for the next time, quietly.
                    if (error as? HKError)?.code == .errorDatabaseInaccessible || error is CancellationError { continue }
                    self.update(t.url) { $0.error = Servers.say(error) }
                }
            }
            self.syncing = false
            self.phase = nil
            self.progress = nil
            if task != .invalid { await UIApplication.shared.endBackgroundTask(task) }
        }
    }

    private func target(_ url: String) -> Target? { targets.first { $0.url == url && $0.on } }

    private func post(_ url: String, _ body: [String: Any]) async throws {
        guard !stopped, let t = target(url), let server = Servers.list.first(where: { $0.url == url }) else { throw CancellationError() }
        var b = body
        b["device"] = await UIDevice.current.name
        _ = try await Servers.call("POST", t.route, b, to: server, timeout: 120)
    }

    private func count(_ url: String, _ key: String, _ n: Int) { update(url) { $0.sent[key, default: 0] += n } }

    private func send(_ url: String) async throws {
        if let t = target(url), (t.version ?? 1) < Self.version {
            update(url) { t in
                t.anchors[Stream.sleep.rawValue] = nil
                t.drained.removeAll { $0 == Stream.sleep.rawValue }
                t.daysFrom = nil; t.daysStart = nil; t.historyAt = nil; t.recent = false
                t.version = Self.version
            }
        }
        guard let t = target(url) else { return }
        let cal = Calendar.current, now = Date()
        // The last week first, so Today has last night at once.
        if !t.recent {
            phase = "Last week"
            let from = cal.date(byAdding: .day, value: -8, to: now)!
            try await sendSleep(url, from: from, to: now.addingTimeInterval(4 * 3600)) // (past the plugin's 3 h edge)
            let workouts = try await HKSampleQueryDescriptor(predicates: [.workout(HKQuery.predicateForSamples(withStart: from, end: nil))], sortDescriptors: []).result(for: store)
            try await sendWorkouts(url, workouts)
            try await sendDays(url, from: cal.startOfDay(for: from), to: now)
            update(url) { $0.recent = true }
        }
        for s in [Stream.sleep, .workouts] { try await drain(url, s) }
        try await sendHistory(url)
        for s in Stream.allCases where s != .sleep && s != .workouts { try await drain(url, s) }
    }

    /// New samples of a stream since its anchor, a page at a time, each page sent before its anchor is kept (so it's
    /// resumable). A day's numbers are its totals, so a page of those sends its days again.
    private func drain(_ url: String, _ s: Stream) async throws {
        let limit = s == .workouts ? 200 : s == .sleep ? 3000 : 10000
        let first = !(target(url)?.drained.contains(s.rawValue) ?? false)
        var oldest: Date?, newest: Date?
        while let t = target(url) {
            let anchor = t.anchors[s.rawValue].flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
            let r = try await HKAnchoredObjectQueryDescriptor(predicates: [.sample(type: type(s))], anchor: anchor, limit: limit).result(for: store)
            let added = r.addedSamples
            if first { phase = s == .sleep ? "Sleep history" : s == .workouts ? "Workouts" : "Activity"; progress = nil }
            if !added.isEmpty {
                switch s {
                case .sleep:
                    // Each run of nights the page has, with the nights around it (a page isn't always in order).
                    var spans: [(Date, Date)] = []
                    for x in added.sorted(by: { $0.startDate < $1.startDate }) {
                        if let l = spans.last, x.startDate.timeIntervalSince(l.1) < 2 * 86400 { spans[spans.count - 1].1 = max(l.1, x.endDate) }
                        else { spans.append((x.startDate, x.endDate)) }
                    }
                    for (a, b) in spans { try await sendSleep(url, from: a.addingTimeInterval(-36 * 3600), to: b.addingTimeInterval(36 * 3600)) }
                    if first, let b = spans.last?.1 { phase = "Sleep through \(Self.month.string(from: b))" }
                case .workouts:
                    try await sendWorkouts(url, added.compactMap { $0 as? HKWorkout })
                default:
                    // The history went by days (sendHistory): the first time, only days since it began are new.
                    let since = first ? t.historyAt.map { $0.addingTimeInterval(-86400) } ?? .distantPast : .distantPast
                    let dates = added.map(\.startDate).filter { $0 >= since }
                    if let a = dates.min(), let b = dates.max() { oldest = min(oldest ?? a, a); newest = max(newest ?? b, b) }
                }
            }
            let kept = try NSKeyedArchiver.archivedData(withRootObject: r.newAnchor, requiringSecureCoding: true)
            update(url) { $0.anchors[s.rawValue] = kept }
            if added.count < limit { break }
        }
        if let a = oldest, let b = newest { try await sendDays(url, from: Calendar.current.startOfDay(for: a), to: b) }
        update(url) { if !$0.drained.contains(s.rawValue) { $0.drained.append(s.rawValue) } }
    }

    /// Every day's numbers since Health's first, newest first, 90 days a post; where it got to is kept.
    private func sendHistory(_ url: String) async throws {
        let cal = Calendar.current
        guard var t = target(url) else { return }
        if t.daysStart == nil {
            var first = Date()
            for m in Self.metrics {
                let q = HKSampleQueryDescriptor(predicates: [.quantitySample(type: HKQuantityType(m.1))], sortDescriptors: [SortDescriptor(\.startDate)], limit: 1)
                if let d = try await q.result(for: store).first?.startDate { first = min(first, d) }
            }
            update(url) { $0.historyAt = Date(); $0.daysStart = Self.day.string(from: cal.startOfDay(for: first)); $0.daysFrom = Self.day.string(from: cal.startOfDay(for: Date()).addingTimeInterval(86400 * 1.5)) }
            t = target(url)!
        }
        guard let start = Self.day.date(from: t.daysStart!) else { return }
        var to = Self.day.date(from: t.daysFrom!) ?? Date()
        let span = max(1, to.timeIntervalSince(start))
        let end = to
        while to > start {
            let from = max(start, cal.date(byAdding: .day, value: -90, to: to)!)
            phase = "Activity back to \(Self.month.string(from: from))"
            progress = end.timeIntervalSince(from) / span
            try await sendDays(url, from: from, to: to.addingTimeInterval(-1))
            to = from
            update(url) { $0.daysFrom = Self.day.string(from: from) }
        }
    }

    // MARK: what it sends

    private func sendSleep(_ url: String, from: Date, to: Date) async throws {
        let p = HKQuery.predicateForSamples(withStart: from, end: to)
        let samples = try await HKSampleQueryDescriptor(predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: p)], sortDescriptors: [SortDescriptor(\.startDate)]).result(for: store)
        guard !samples.isEmpty else { return }
        let rows = samples.compactMap { s -> [String]? in
            guard let v = Self.sleepValues[s.value] else { return nil }
            let z = Self.zone(s)
            return [Self.stamp(s.startDate, z), Self.stamp(s.endDate, z), "HKCategoryValueSleepAnalysis" + v]
        }
        try await post(url, ["sleep": ["samples": rows, "from": Self.stamp(from, .current), "to": Self.stamp(to, .current)]])
        count(url, "sleep", rows.count)
    }

    private static let sleepValues: [Int: String] = [
        HKCategoryValueSleepAnalysis.inBed.rawValue: "InBed", HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: "AsleepUnspecified",
        HKCategoryValueSleepAnalysis.awake.rawValue: "Awake", HKCategoryValueSleepAnalysis.asleepCore.rawValue: "AsleepCore",
        HKCategoryValueSleepAnalysis.asleepDeep.rawValue: "AsleepDeep", HKCategoryValueSleepAnalysis.asleepREM.rawValue: "AsleepREM",
    ]

    /// Workouts as an export's Workout elements (the plugin reads both the same way).
    private func sendWorkouts(_ url: String, _ workouts: [HKWorkout]) async throws {
        guard !workouts.isEmpty else { return }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let items: [[String: Any]] = workouts.map { w in
            let z = Self.zone(w)
            var stats: [[String: Any]] = []
            if let e = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() {
                stats.append(["type": HKQuantityTypeIdentifier.activeEnergyBurned.rawValue, "sum": e.doubleValue(for: .kilocalorie()), "unit": "kcal"])
            }
            if let hr = w.statistics(for: HKQuantityType(.heartRate)) {
                var o: [String: Any] = ["type": HKQuantityTypeIdentifier.heartRate.rawValue, "unit": "count/min"]
                if let a = hr.averageQuantity() { o["average"] = a.doubleValue(for: bpm) }
                if let m = hr.maximumQuantity() { o["maximum"] = m.doubleValue(for: bpm) }
                stats.append(o)
            }
            for d in Self.distances {
                if let q = w.statistics(for: HKQuantityType(d))?.sumQuantity() {
                    stats.append(["type": d.rawValue, "sum": q.doubleValue(for: .meterUnit(with: .kilo)), "unit": "km"])
                    break
                }
            }
            var meta: [String: String] = [:]
            if let indoor = w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool { meta["HKIndoorWorkout"] = indoor ? "1" : "0" }
            return ["workoutActivityType": "HKWorkoutActivityType" + Self.activityName(w.workoutActivityType),
                    "startDate": Self.stamp(w.startDate, z), "endDate": Self.stamp(w.endDate, z),
                    "duration": w.duration / 60, "durationUnit": "min", "meta": meta, "stats": stats]
        }
        try await post(url, ["workouts": items])
        count(url, "workouts", items.count)
    }

    /// Each day's numbers from `from`'s day through `to`'s, as Health adds them up (one source per moment, as its own
    /// charts), 200 days a post.
    private func sendDays(_ url: String, from: Date, to: Date) async throws {
        let cal = Calendar.current
        let a = cal.startOfDay(for: from), b = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: to))!
        guard a < b else { return }
        var days: [String: [String: Any]] = [:]
        for m in Self.metrics {
            let q = HKStatisticsCollectionQueryDescriptor(predicate: .quantitySample(type: HKQuantityType(m.1), predicate: HKQuery.predicateForSamples(withStart: a, end: b)),
                                                          options: m.2, anchorDate: a, intervalComponents: DateComponents(day: 1))
            let stats = try await q.result(for: store)
            stats.enumerateStatistics(from: a, to: b) { s, _ in
                let quantity = m.2 == .cumulativeSum ? s.sumQuantity() : m.2 == .mostRecent ? s.mostRecentQuantity() : s.averageQuantity()
                guard let v = quantity?.doubleValue(for: m.3), v > 0 else { return }
                days[Self.day.string(from: s.startDate), default: [:]][m.4] = v
            }
        }
        // The rings, as the Activity app shows them: what was done and each one's goal.
        let range = HKQuery.predicate(forActivitySummariesBetweenStart: cal.dateComponents([.year, .month, .day, .era], from: a),
                                      end: cal.dateComponents([.year, .month, .day, .era], from: b.addingTimeInterval(-1)))
        for r in try await HKActivitySummaryQueryDescriptor(predicate: range).result(for: store) {
            guard let d = cal.date(from: r.dateComponents(for: cal)) else { continue }
            var o: [String: Any] = [:]
            let stand = r.appleStandHours.doubleValue(for: .count())
            if stand > 0 { o["stand_h"] = stand }
            let move = r.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie())
            if move > 0 { o["move_goal"] = move }
            if let g = r.exerciseTimeGoal?.doubleValue(for: .minute()), g > 0 { o["exercise_goal"] = g }
            if let g = r.standHoursGoal?.doubleValue(for: .count()), g > 0 { o["stand_goal"] = g }
            if !o.isEmpty { days[Self.day.string(from: d), default: [:]].merge(o) { x, _ in x } }
        }
        let rows = days.sorted { $0.key > $1.key }.map { d, v in v.merging(["date": d]) { x, _ in x } }
        for i in stride(from: 0, to: rows.count, by: 200) {
            try await post(url, ["days": Array(rows[i..<min(i + 200, rows.count)])])
            count(url, "days", min(200, rows.count - i))
        }
    }

    // MARK: times and names

    /// Where a sample happened (the Watch writes it on workouts and sleep), else here.
    private static func zone(_ s: HKSample) -> TimeZone {
        (s.metadata?[HKMetadataKeyTimeZone] as? String).flatMap(TimeZone.init(identifier:)) ?? .current
    }

    /// A time as an export writes it: "2026-09-26 23:10:00 -0700", local to where it happened.
    private static func stamp(_ d: Date, _ z: TimeZone) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = z
        f.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        return f.string(from: d)
    }

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let month: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMMM yyyy"
        return f
    }()

    /// A workout type's name as an export writes it (after HKWorkoutActivityType).
    static func activityName(_ t: HKWorkoutActivityType) -> String {
        let names: [HKWorkoutActivityType: String] = [
            .americanFootball: "AmericanFootball", .archery: "Archery", .australianFootball: "AustralianFootball", .badminton: "Badminton",
            .baseball: "Baseball", .basketball: "Basketball", .bowling: "Bowling", .boxing: "Boxing", .climbing: "Climbing",
            .cricket: "Cricket", .crossTraining: "CrossTraining", .curling: "Curling", .cycling: "Cycling", .elliptical: "Elliptical",
            .equestrianSports: "EquestrianSports", .fencing: "Fencing", .fishing: "Fishing", .functionalStrengthTraining: "FunctionalStrengthTraining",
            .golf: "Golf", .gymnastics: "Gymnastics", .handball: "Handball", .hiking: "Hiking", .hockey: "Hockey", .hunting: "Hunting",
            .lacrosse: "Lacrosse", .martialArts: "MartialArts", .mindAndBody: "MindAndBody", .paddleSports: "PaddleSports", .play: "Play",
            .preparationAndRecovery: "PreparationAndRecovery", .racquetball: "Racquetball", .rowing: "Rowing", .rugby: "Rugby",
            .running: "Running", .sailing: "Sailing", .skatingSports: "SkatingSports", .snowSports: "SnowSports", .soccer: "Soccer",
            .softball: "Softball", .squash: "Squash", .stairClimbing: "StairClimbing", .surfingSports: "SurfingSports", .swimming: "Swimming",
            .tableTennis: "TableTennis", .tennis: "Tennis", .trackAndField: "TrackAndField", .traditionalStrengthTraining: "TraditionalStrengthTraining",
            .volleyball: "Volleyball", .walking: "Walking", .waterFitness: "WaterFitness", .waterPolo: "WaterPolo", .waterSports: "WaterSports",
            .wrestling: "Wrestling", .yoga: "Yoga", .barre: "Barre", .coreTraining: "CoreTraining", .crossCountrySkiing: "CrossCountrySkiing",
            .downhillSkiing: "DownhillSkiing", .flexibility: "Flexibility", .highIntensityIntervalTraining: "HighIntensityIntervalTraining",
            .jumpRope: "JumpRope", .kickboxing: "Kickboxing", .pilates: "Pilates", .snowboarding: "Snowboarding", .stairs: "Stairs",
            .stepTraining: "StepTraining", .wheelchairWalkPace: "WheelchairWalkPace", .wheelchairRunPace: "WheelchairRunPace", .taiChi: "TaiChi",
            .mixedCardio: "MixedCardio", .handCycling: "HandCycling", .discSports: "DiscSports", .fitnessGaming: "FitnessGaming",
            .cardioDance: "CardioDance", .socialDance: "SocialDance", .pickleball: "Pickleball", .cooldown: "Cooldown",
            .swimBikeRun: "SwimBikeRun", .transition: "Transition", .underwaterDiving: "UnderwaterDiving",
        ]
        return names[t] ?? "Other"
    }
}

/// One run at a time: a run asked for meanwhile makes the current one go once more, and waits for it.
private actor Runner {
    private var running = false, again = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func run(_ body: @escaping () async -> Void) async {
        if running { again = true; await withCheckedContinuation { waiting.append($0) }; return }
        running = true
        repeat { again = false; await body() } while again
        running = false
        let w = waiting
        waiting = []
        w.forEach { $0.resume() }
    }
}
