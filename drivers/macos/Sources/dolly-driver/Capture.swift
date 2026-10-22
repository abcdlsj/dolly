import AppKit
import Foundation
import ImageIO

/// Window-only capture. `screencapture -l <windowID>` grabs one window
/// without stealing focus: as video, as a burst of stills from several loops
/// in parallel, or as one still to look at.
enum Capture {
    /// One window recorded as video, straight from `screencapture -v`. It
    /// keeps the display's frame rate instead of the ~6 fps a still-image loop
    /// reaches, which is what a camera move needs.
    static func video(windowID: Int, file: URL, seconds: Double) throws -> [String: Any] {
        guard let window = WindowList.list(layer: nil).first(where: { $0.id == windowID }) else {
            throw Failure("no window \(windowID)", code: .failed)
        }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        // Window-only: whatever a person drags in front of it cannot leak into
        // the recording, and the take is exactly the window's pixels.
        process.arguments = ["-v", "-V", String(seconds), "-l", String(windowID), "-o", "-x", file.path]
        process.standardError = FileHandle.nullDevice
        let started = Date()
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: file.path) else {
            throw Failure("screencapture failed for window \(windowID); is Screen Recording granted?", code: .failed)
        }
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        return [
            "started": milliseconds(started),
            "pixels": [Int(window.bounds.width * scale), Int(window.bounds.height * scale)],
        ]
    }

    /// One frame of one window, shadow left out so the image is exactly the
    /// window's frame at the display's scale, then fitted to `longest` pixels
    /// (0 keeps it): a model reads a smaller image just as well.
    static func still(windowID: Int, file: URL, longest: Int) throws -> [String: Any] {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try run("/usr/sbin/screencapture", ["-l", String(windowID), "-o", "-x", "-t", "png", file.path],
                failure: "screencapture failed for window \(windowID); is Screen Recording granted?")
        if longest > 0, let size = imageSize(file), max(size.width, size.height) > longest {
            try run("/usr/bin/sips", ["-Z", String(longest), file.path], failure: "sips could not resize \(file.path)")
        }
        guard let size = imageSize(file) else { throw Failure("cannot read \(file.path)", code: .failed) }
        return ["pixels": [size.width, size.height]]
    }

    private static func imageSize(_ file: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (width, height)
    }

    private static func run(_ binary: String, _ arguments: [String], failure: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw Failure(failure, code: .failed) }
    }

    private static func milliseconds(_ date: Date) -> Int {
        Int(date.timeIntervalSince1970 * 1000)
    }

    /// Frames are written under their millisecond timestamp, so a cut can pick
    /// any span without re-encoding the whole take first.
    static func frames(
        windowID: Int,
        directory: URL,
        seconds: Double,
        loops: Int
    ) throws -> [String: Any] {
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
        return [
            "started": milliseconds(started),
            "frames": counter.value,
            "seconds": (duration * 1000).rounded() / 1000,
        ]
    }

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
