import AppKit
import Foundation
import ImageIO

/// The verbs an agent explores an app with before it films it: start a copy
/// it may break, look at a window, read its controls, close it again.

// MARK: - snap

enum Snap {
    static let name = "snap"
    static let summary = "save one frame of a window as PNG, to look at it"
    static let usage = "dolly snap <windowID|--pid n> <out.png> [--max 1600]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let window: WindowInfo
        let path: String?
        if let pid = args.string("pid").flatMap(Int32.init) {
            window = try Target.pick(pid: pid)
            path = args.positional[safe: 0]
        } else {
            guard let id = args.positional[safe: 0].flatMap(Int.init),
                  let found = WindowList.list(layer: nil).first(where: { $0.id == id }) else {
                throw Failure("expected a window id or --pid")
            }
            window = found
            path = args.positional[safe: 1]
        }
        guard let path else { throw Failure("expected an output file") }
        let file = args.file(path)
        try Capture.still(windowID: window.id, file: file)

        // A model reads a smaller image just as well and for a fraction of the
        // tokens; `scale` keeps the way back to screen points exact.
        let limit = args.int("max", 1600)
        if limit > 0, let size = Image.size(file), max(size.width, size.height) > limit {
            try Image.fit(file, longest: limit)
        }
        guard let size = Image.size(file), window.bounds.width > 0 else {
            throw Failure("cannot read \(file.path)", code: .failed)
        }
        let scale = Double(size.width) / window.bounds.width
        return [
            "window": window.id,
            "pid": Int(window.pid),
            "file": file.path,
            "frame": [window.bounds.minX, window.bounds.minY, window.bounds.width, window.bounds.height],
            "pixels": [size.width, size.height],
            "scale": (scale * 10000).rounded() / 10000,
            "map": "screen x = frame.x + pixel x / scale; rect x = pixel x / pixels.width",
        ]
    }
}

enum Image {
    static func size(_ file: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (width, height)
    }

    static func fit(_ file: URL, longest: Int) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
        process.arguments = ["-Z", String(longest), file.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw Failure("sips could not resize \(file.path)", code: .failed)
        }
    }
}

// MARK: - tree

enum Tree {
    static let name = "tree"
    static let summary = "list a window's controls with frames and shot-file rects"
    static let usage = "dolly tree <pid> [--window id] [--depth 40] [--limit 600] [--menus]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        guard let pid = args.positional[safe: 0].flatMap(Int32.init) else {
            throw Failure("expected a pid")
        }
        let window: WindowInfo
        if let id = args.string("window").flatMap(Int.init) {
            guard let found = WindowList.list(pid: pid, layer: nil).first(where: { $0.id == id }) else {
                throw Failure("no window \(id) for pid \(pid)", code: .failed)
            }
            window = found
        } else {
            window = try Target.pick(pid: pid)
        }
        guard window.bounds.width > 0, window.bounds.height > 0 else {
            throw Failure("window \(window.id) has no size", code: .failed)
        }
        let result = Accessibility.tree(
            pid: pid,
            window: window.bounds,
            depth: args.int("depth", 40),
            limit: args.int("limit", 600),
            menus: args.flag("menus")
        )
        return [
            "pid": Int(pid),
            "window": window.json,
            "count": result.nodes.count,
            "truncated": result.truncated,
            "nodes": result.nodes,
        ]
    }
}

// MARK: - launch / quit

enum Launch {
    static let name = "launch"
    static let summary = "start an app (optionally an isolated copy) and wait for its window"
    static let usage = "dolly launch <app path|bundle id> [--isolated [dir]] [--arg x]... [--size w,h] [--at x,y] [--wait 20]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard let target = args.positional[safe: 0] else { throw Failure("expected an app") }
        let app = try resolve(target, args)
        let bundle = Bundle(url: app)
        let identifier = bundle?.bundleIdentifier ?? app.deletingPathExtension().lastPathComponent

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.arguments = args.flags["arg"] ?? []
        var profile: URL?
        if let isolated = args.string("isolated") {
            let directory = isolated == "true" ? defaultProfile(identifier) : args.file(isolated)
            try prepare(directory)
            // HOME moves NSHomeDirectory and with it Application Support,
            // Caches and every dotfile; a second instance keeps the user's
            // own copy of the app untouched.
            configuration.environment = [
                "HOME": directory.path,
                "TMPDIR": directory.appendingPathComponent("tmp").path + "/",
                "XDG_CONFIG_HOME": directory.appendingPathComponent(".config").path,
                "XDG_DATA_HOME": directory.appendingPathComponent(".local/share").path,
                "XDG_CACHE_HOME": directory.appendingPathComponent(".cache").path,
            ]
            configuration.createsNewApplicationInstance = true
            profile = directory
        }

        let pid = try open(app, configuration)
        let deadline = Date().addingTimeInterval(args.double("wait", 20))
        var window: WindowInfo?
        while Date() < deadline {
            window = try? Target.pick(pid: pid)
            if window != nil { break }
            Thread.sleep(forTimeInterval: 0.25)
        }

        if window != nil, Accessibility.trusted() {
            if let size = args.string("size").flatMap(Point.parse) {
                try Accessibility.resize(pid: pid, width: size.x, height: size.y)
            }
            if let origin = args.string("at").flatMap(Point.parse) {
                try Accessibility.place(pid: pid, at: origin)
            }
            if args.string("size") != nil || args.string("at") != nil {
                Thread.sleep(forTimeInterval: 0.3)
                window = try? Target.pick(pid: pid)
            }
        }

        var fields: [String: Any] = [
            "pid": Int(pid),
            "app": app.path,
            "bundle": identifier,
            "ready": window != nil,
        ]
        if let window { fields["window"] = window.json }
        if let profile {
            fields["profile"] = profile.path
            if sandboxed(app) {
                fields["warning"] = "sandboxed app: its container is not moved by --isolated, so it shares data with the user's copy"
            }
        }
        return fields
    }

    private static func resolve(_ target: String, _ args: Args) throws -> URL {
        let path = args.file(target)
        if FileManager.default.fileExists(atPath: path.path) { return path }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: target) { return url }
        for root in ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"] {
            let candidate = URL(fileURLWithPath: root).appendingPathComponent(target.hasSuffix(".app") ? target : target + ".app")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        throw Failure("no app \"\(target)\": pass a path, a bundle id or an app name", code: .failed)
    }

    private static func defaultProfile(_ identifier: String) -> URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let stamp = Int(Date().timeIntervalSince1970)
        return caches.appendingPathComponent("dolly/profiles/\(identifier)-\(stamp)")
    }

    private static func prepare(_ directory: URL) throws {
        for sub in ["tmp", "Library/Application Support", "Library/Caches", "Library/Preferences", ".config", ".local/share", ".cache"] {
            try FileManager.default.createDirectory(
                at: directory.appendingPathComponent(sub),
                withIntermediateDirectories: true
            )
        }
    }

    private static func open(_ app: URL, _ configuration: NSWorkspace.OpenConfiguration) throws -> pid_t {
        let box = Launched()
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { running, error in
            box.finish(pid: running?.processIdentifier, error: error)
        }
        guard box.wait(seconds: 30) else { throw Failure("timed out opening \(app.path)", code: .failed) }
        if let error = box.error { throw Failure("cannot open \(app.path): \(error.localizedDescription)", code: .failed) }
        guard let pid = box.pid else { throw Failure("cannot open \(app.path)", code: .failed) }
        return pid
    }

    private static func sandboxed(_ app: URL) -> Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code else { return false }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let dictionary = info as? [String: Any],
              let entitlements = dictionary[kSecCodeInfoEntitlementsDict as String] as? [String: Any] else { return false }
        return entitlements["com.apple.security.app-sandbox"] as? Bool ?? false
    }

    /// The completion handler runs on a queue of LaunchServices' choosing.
    private final class Launched: @unchecked Sendable {
        private let done = DispatchSemaphore(value: 0)
        private(set) var pid: pid_t?
        private(set) var error: Error?

        func finish(pid: pid_t?, error: Error?) {
            self.pid = pid
            self.error = error
            done.signal()
        }

        func wait(seconds: Double) -> Bool {
            done.wait(timeout: .now() + seconds) == .success
        }
    }
}

enum Quit {
    static let name = "quit"
    static let summary = "quit an app, e.g. the isolated copy a shoot started"
    static let usage = "dolly quit <pid> [--force] [--wait 5]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard let pid = args.positional[safe: 0].flatMap(Int32.init) else { throw Failure("expected a pid") }
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            return ["pid": Int(pid), "running": false]
        }
        let force = args.flag("force")
        _ = force ? app.forceTerminate() : app.terminate()
        // `isTerminated` only updates on a running main loop, which a CLI and
        // the service do not have; asking the kernel works anywhere.
        let alive = { kill(pid, 0) == 0 }
        let deadline = Date().addingTimeInterval(args.double("wait", 5))
        while Date() < deadline, alive() {
            Thread.sleep(forTimeInterval: 0.1)
        }
        return ["pid": Int(pid), "running": alive(), "forced": force]
    }
}
