import CoreGraphics
import Foundation

/// Machine-first CLI plumbing: a declarative command table, uniform flag
/// parsing and a single-line JSON result per run. Adding a command means
/// adding one `Command` type and one line in `registry`.

// MARK: - Result

/// Exit codes are part of the contract so a caller can branch without
/// parsing text.
enum Exit: Int32 {
    case ok = 0
    case usage = 2
    case refused = 3
    case untrusted = 4
    case failed = 5
}

struct Failure: Error {
    let code: Exit
    let message: String
    init(_ message: String, code: Exit = .usage) {
        self.message = message
        self.code = code
    }
}

// MARK: - Arguments

/// Parsed arguments: positional values in order, `--flag value` and
/// `--flag=value` in a dictionary, so a repeated flag collects every value.
struct Args {
    var positional: [String] = []
    var flags: [String: [String]] = [:]
    /// The caller's working directory. A forwarded call runs inside the
    /// service, whose own directory is `/`, so relative paths resolve here.
    var cwd: String?

    static func parse(_ raw: [String]) throws -> Args {
        var args = Args()
        var index = 0
        while index < raw.count {
            let token = raw[index]
            guard token.hasPrefix("--") else {
                args.positional.append(token)
                index += 1
                continue
            }
            let body = String(token.dropFirst(2))
            if let equals = body.firstIndex(of: "=") {
                let name = String(body[..<equals])
                args.flags[name, default: []].append(String(body[body.index(after: equals)...]))
                index += 1
                continue
            }
            let next = index + 1 < raw.count ? raw[index + 1] : nil
            if let next, !next.hasPrefix("--") {
                args.flags[body, default: []].append(next)
                index += 2
            } else {
                args.flags[body, default: []].append("true")
                index += 1
            }
        }
        return args
    }

    func string(_ name: String, _ fallback: String? = nil) -> String? {
        flags[name]?.last ?? fallback
    }

    func strings(_ name: String) -> [String] {
        (flags[name] ?? []).flatMap { $0.split(separator: ",").map(String.init) }
    }

    func int(_ name: String, _ fallback: Int) -> Int {
        string(name).flatMap(Int.init) ?? fallback
    }

    func double(_ name: String, _ fallback: Double) -> Double {
        string(name).flatMap(Double.init) ?? fallback
    }

    func flag(_ name: String) -> Bool {
        guard let value = string(name) else { return false }
        return value != "false" && value != "0" && value != "no"
    }

    /// A file argument as the caller meant it: `~` expanded, relative paths
    /// taken from the caller's directory rather than the service's.
    func file(_ text: String) -> URL {
        let expanded = (text as NSString).expandingTildeInPath
        if expanded.hasPrefix("/") { return URL(fileURLWithPath: expanded).standardizedFileURL }
        let base = URL(fileURLWithPath: cwd ?? FileManager.default.currentDirectoryPath, isDirectory: true)
        return URL(fileURLWithPath: expanded, relativeTo: base).standardizedFileURL
    }

    func require(_ count: Int, _ usage: String) throws {
        guard positional.count >= count else {
            throw Failure("expected \(usage)")
        }
    }
}

// MARK: - Command table

/// One CLI verb: plain data plus the function that runs it, so the table
/// below stays a readable list and a new verb is one `spec` line.
struct Command {
    let name: String
    let summary: String
    let usage: String
    let run: @Sendable (Args) throws -> [String: Any]
}

enum Registry {
    static let all: [Command] = [
        Move.spec,
        Path.spec,
        Hover.spec,
        Click.spec,
        Drag.spec,
        Scroll.spec,
        Key.spec,
        Type.spec,
        Press.spec,
        Place.spec,
        Resize.spec,
        Focus.spec,
        Dump.spec,
        Find.spec,
        Front.spec,
        Windows.spec,
        Trust.spec,
        Record.spec,
        CaptureFilm.spec,
        Snap.spec,
        Tree.spec,
        Launch.spec,
        Quit.spec,
        Events.spec,
        Help.spec,
    ]

    static func lookup(_ name: String) -> Command? {
        all.first { $0.name == name }
    }
}

// MARK: - Shared flags

enum Shared {
    /// `--guard` names the app that must be frontmost: a pid, a bundle id or
    /// an app name. Anything else and the input is refused untouched.
    static func guardFront(_ args: Args) throws {
        let allowed = args.strings("guard")
        guard !allowed.isEmpty else { return }
        guard let front = FrontApp.describe() else {
            throw Failure("no frontmost app", code: .refused)
        }
        let matched = allowed.contains {
            $0 == String(front.pid) || $0 == front.bundle || $0 == front.name
        }
        guard matched else {
            throw Failure(
                "refused: frontmost is \(front.name) (\(front.bundle), pid \(front.pid))",
                code: .refused
            )
        }
    }

    /// `--owner` names the app that must own the window under the pointer. It
    /// covers the first click of a session, when the target is not frontmost
    /// yet and a `--guard` would be wrong to demand.
    static func guardOwner(_ args: Args) throws {
        guard let owner = args.string("owner").flatMap(Int32.init) else { return }
        let location = CGEvent(source: nil)?.location ?? .zero
        let point = Point(x: Double(location.x), y: Double(location.y))
        guard let window = WindowList.at(point) else {
            throw Failure("refused: no window under the pointer", code: .refused)
        }
        guard window.pid == owner else {
            throw Failure("refused: window under the pointer belongs to pid \(window.pid), not \(owner)", code: .refused)
        }
    }

    static func requireTrust() throws {
        // DOLLY_ASSUME_TRUST exists for diagnosing whether events land when
        // this shell is not the trusted process; it never changes the check
        // the tool reports.
        if ProcessInfo.processInfo.environment["DOLLY_ASSUME_TRUST"] == "1" { return }
        guard Accessibility.trusted() else {
            throw Failure("Accessibility is not granted to this binary", code: .untrusted)
        }
    }

    static func ease(_ args: Args) -> Ease {
        Ease(rawValue: args.string("ease") ?? "inOut") ?? .inOut
    }

    static func poster() -> Poster {
        Poster()
    }
}

enum Usage {
    static func text() -> String {
        var lines = [
            "dolly — pointer, keyboard and accessibility input for screen recordings",
            "",
            "Usage: dolly <command> [positional...] [--flags]",
            "",
            "Commands:",
        ]
        for command in Registry.all where command.name != "help" {
            lines.append("  \(pad(command.name, 9)) \(command.summary)")
            lines.append("  \(String(repeating: " ", count: 9))   \(command.usage)")
        }
        lines.append("")
        lines.append("Service (macOS grants Accessibility per process; a launchd-started")
        lines.append("dolly is its own process, so calls from any shell keep working):")
        lines.append("  dolly service start|stop|status")
        lines.append("  dolly serve --socket <path>    run the service in the foreground")
        lines.append("")
        lines.append("Shared flags:")
        lines.append("  --guard <pid|bundle|name>  refuse to run unless that app is frontmost")
        lines.append("  --owner <pid>              refuse unless the window under the pointer is that app's")
        lines.append("  --ms <n>                   travel time in milliseconds (default 700)")
        lines.append("  --ease inOut|out|inQuint|linear")
        lines.append("")
        lines.append("Every command prints one JSON object with ok, command, code and its own")
        lines.append("fields; this text is the help command's `text` field.")
        lines.append("Exit codes: 0 ok, 2 usage, 3 refused, 4 untrusted, 5 failed.")
        return lines.joined(separator: "\n")
    }

    private static func pad(_ text: String, _ width: Int) -> String {
        text.padding(toLength: max(width, text.count), withPad: " ", startingAt: 0)
    }
}
