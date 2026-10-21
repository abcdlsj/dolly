import Foundation

/// Window-only frame capture. `screencapture -l <windowID>` grabs one window
/// without stealing focus, and several loops in parallel lift the frame rate
/// to something a camera move can be retimed from.
enum Capture {
    static func frames(
        windowID: Int,
        directory: URL,
        seconds: Double,
        loops: Int
    ) throws -> (count: Int, duration: Double) {
        let binary = URL(fileURLWithPath: "/usr/sbin/screencapture")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else {
            throw Failure("screencapture is missing", code: .failed)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let started = Date()
        let deadline = started.addingTimeInterval(seconds)
        let group = DispatchGroup()
        let counter = Counter()

        for _ in 0..<max(loops, 1) {
            DispatchQueue.global(qos: .userInitiated).async(group: group) {
                while Date() < deadline {
                    let stamp = Int(Date().timeIntervalSince1970 * 1000)
                    let frame = directory.appendingPathComponent("\(stamp).png")
                    let process = Process()
                    process.executableURL = binary
                    process.arguments = ["-l", String(windowID), "-o", "-x", "-t", "png", frame.path]
                    process.standardError = FileHandle.nullDevice
                    process.standardOutput = FileHandle.nullDevice
                    try? process.run()
                    process.waitUntilExit()
                    if process.terminationStatus == 0, FileManager.default.fileExists(atPath: frame.path) {
                        counter.increment()
                    }
                }
            }
        }
        group.wait()

        let duration = Date().timeIntervalSince(started)
        return (counter.value, duration)
    }

    /// Frames are written under their millisecond timestamp, so a cut can pick
    /// any span without re-encoding the whole take first.
    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0

        func increment() {
            lock.lock()
            count += 1
            lock.unlock()
        }

        var value: Int {
            lock.lock()
            defer { lock.unlock() }
            return count
        }
    }
}
