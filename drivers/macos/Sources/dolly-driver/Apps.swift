import AppKit
import Foundation
import Security

/// Starting and stopping apps. Which app, with what profile and how long to
/// wait for its window is decided in TypeScript.
enum Apps {
    static func describe(_ app: NSRunningApplication) -> [String: Any] {
        ["pid": Int(app.processIdentifier), "name": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? ""]
    }

    /// Opens an app through LaunchServices. `environment` is added to the
    /// app's own; `fresh` opens a new instance even when one is running, which
    /// is what an isolated profile needs to leave the user's copy alone.
    static func launch(target: String, arguments: [String], environment: [String: String], fresh: Bool) throws -> [String: Any] {
        let app = try resolve(target)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.arguments = arguments
        if !environment.isEmpty { configuration.environment = environment }
        configuration.createsNewApplicationInstance = fresh

        let box = Launched()
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { running, error in
            box.finish(pid: running?.processIdentifier, error: error)
        }
        guard box.wait(seconds: 30) else { throw Failure("timed out opening \(app.path)", code: .failed) }
        if let error = box.error { throw Failure("cannot open \(app.path): \(error.localizedDescription)", code: .failed) }
        guard let pid = box.pid else { throw Failure("cannot open \(app.path)", code: .failed) }
        return [
            "pid": Int(pid),
            "app": app.path,
            "bundle": Bundle(url: app)?.bundleIdentifier ?? app.deletingPathExtension().lastPathComponent,
            "sandboxed": sandboxed(app),
        ]
    }

    /// Asks an app to quit, or kills it, and waits for it to exit.
    /// `isTerminated` only updates on a running main loop, which the driver
    /// does not have; asking the kernel works anywhere.
    static func quit(pid: pid_t, force: Bool, wait: Double) -> [String: Any] {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return ["running": false] }
        _ = force ? app.forceTerminate() : app.terminate()
        let alive = { kill(pid, 0) == 0 }
        let deadline = Date().addingTimeInterval(wait)
        while Date() < deadline, alive() {
            Thread.sleep(forTimeInterval: 0.1)
        }
        return ["running": alive()]
    }

    /// A path, a bundle id, or a name in the usual Applications folders.
    private static func resolve(_ target: String) throws -> URL {
        let expanded = (target as NSString).expandingTildeInPath
        if FileManager.default.fileExists(atPath: expanded) { return URL(fileURLWithPath: expanded) }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: target) { return url }
        let name = target.hasSuffix(".app") ? target : target + ".app"
        for root in ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"] {
            let candidate = URL(fileURLWithPath: root).appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        throw Failure("no app \"\(target)\": pass a path, a bundle id or an app name", code: .failed)
    }

    /// A sandboxed app keeps its data in its container whatever HOME says, so
    /// an isolated profile does not isolate it; the CLI warns about that.
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
