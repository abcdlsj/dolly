import Foundation

/// A log of what happened during a take, so camera moves can land on the
/// frame an input happened instead of on a guess.
///
/// `dolly events start <file>` arms the log; from then on every input verb and
/// every `record`/`capture` appends one JSON line with its wall-clock span.
/// The arming is a file next to the socket rather than process state, so a
/// direct run and a forwarded one write to the same log.
enum EventLog {
    /// Verbs worth a line: everything that moves, clicks or types, plus the
    /// captures the times are measured against.
    static let logged: Set<String> = [
        "move", "path", "hover", "click", "drag", "scroll", "key", "type", "press",
        "record", "capture",
    ]

    private static let lock = NSLock()

    static var armPath: URL {
        URL(fileURLWithPath: Service.socketPath).deletingLastPathComponent().appendingPathComponent("events.path")
    }

    static func armed() -> URL? {
        guard let text = try? String(contentsOf: armPath, encoding: .utf8) else { return nil }
        let path = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : URL(fileURLWithPath: path)
    }

    static func arm(_ file: URL) throws {
        try FileManager.default.createDirectory(at: armPath.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: file)
        try file.path.write(to: armPath, atomically: true, encoding: .utf8)
    }

    static func disarm() {
        try? FileManager.default.removeItem(at: armPath)
    }

    /// Called by the runner after a verb succeeds.
    static func note(verb: String, started: Date, ended: Date, fields: [String: Any]) {
        guard logged.contains(verb), let file = armed() else { return }
        var entry: [String: Any] = [
            "verb": verb,
            "t": milliseconds(started),
            "end": milliseconds(ended),
        ]
        for key in ["to", "from", "label", "pid", "key", "characters", "dy", "dx", "clicks", "held", "window", "file", "directory", "region", "started"] {
            if let value = fields[key] { entry[key] = value }
        }
        // A capture's own start is closer to its first frame than the verb's.
        if let start = fields["started"] as? Int { entry["t"] = start }
        // The window's frame at capture time is what turns screen points into
        // the window fractions a shot file uses.
        if let id = fields["window"] as? Int,
           let window = WindowList.list(layer: nil).first(where: { $0.id == id }) {
            entry["frame"] = [window.bounds.minX, window.bounds.minY, window.bounds.width, window.bounds.height]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys, .withoutEscapingSlashes]) else { return }
        lock.lock()
        defer { lock.unlock() }
        guard let handle = try? FileHandle(forWritingTo: file) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data + Data("\n".utf8))
    }

    static func read(_ file: URL) -> [[String: Any]] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
    }

    /// Lines turned into beats: seconds since the take started and pointer
    /// targets as fractions of the recorded window, ready for a shot file's
    /// `at` and `point`.
    static func beats(_ entries: [[String: Any]]) -> (origin: Int?, frame: [Double]?, beats: [[String: Any]]) {
        let take = entries.first { ["record", "capture"].contains($0["verb"] as? String ?? "") }
        let origin = take?["t"] as? Int
        let frame = take?["frame"] as? [Double]
        var beats: [[String: Any]] = []
        for entry in entries {
            guard let verb = entry["verb"] as? String, verb != "record", verb != "capture",
                  let t = entry["t"] as? Int, let end = entry["end"] as? Int else { continue }
            var beat: [String: Any] = ["verb": verb]
            if let origin {
                beat["at"] = seconds(t - origin)
                beat["until"] = seconds(end - origin)
            }
            if let label = entry["label"] { beat["label"] = label }
            if let target = target(entry) {
                beat["screen"] = [target.x, target.y]
                if let frame, frame.count == 4, frame[2] > 0, frame[3] > 0 {
                    beat["point"] = [
                        rounded((target.x - frame[0]) / frame[2]),
                        rounded((target.y - frame[1]) / frame[3]),
                    ]
                }
            }
            beats.append(beat)
        }
        return (origin, frame, beats)
    }

    /// Where the pointer ended up: the last point of a travel, a drag's drop.
    private static func target(_ entry: [String: Any]) -> Point? {
        if let to = entry["to"] as? [[String: Any]], let last = to.last,
           let x = last["x"] as? Double, let y = last["y"] as? Double {
            return Point(x: x, y: y)
        }
        if let to = entry["to"] as? [String: Any], let x = to["x"] as? Double, let y = to["y"] as? Double {
            return Point(x: x, y: y)
        }
        return nil
    }

    private static func milliseconds(_ date: Date) -> Int { Int(date.timeIntervalSince1970 * 1000) }
    private static func seconds(_ ms: Int) -> Double { (Double(ms) / 10).rounded() / 100 }
    private static func rounded(_ value: Double) -> Double { (value * 10000).rounded() / 10000 }
}

enum Events {
    static let name = "events"
    static let summary = "log input and capture times during a take, as shot-file beats"
    static let usage = "dolly events start <file.jsonl> | stop | status"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        switch args.positional[safe: 0] ?? "status" {
        case "start":
            guard let path = args.positional[safe: 1] else { throw Failure("expected a log file") }
            let file = args.file(path)
            try EventLog.arm(file)
            return ["action": "start", "file": file.path]
        case "stop":
            guard let file = EventLog.armed() else { throw Failure("no event log is running", code: .failed) }
            EventLog.disarm()
            return summary("stop", file)
        case "status":
            guard let file = EventLog.armed() else { return ["action": "status", "running": false] }
            var fields = summary("status", file)
            fields["running"] = true
            return fields
        default:
            throw Failure("expected start, stop or status")
        }
    }

    private static func summary(_ action: String, _ file: URL) -> [String: Any] {
        let entries = EventLog.read(file)
        let result = EventLog.beats(entries)
        var fields: [String: Any] = [
            "action": action,
            "file": file.path,
            "count": entries.count,
            "beats": result.beats,
        ]
        if let origin = result.origin { fields["origin"] = origin }
        if let frame = result.frame { fields["frame"] = frame }
        return fields
    }
}
