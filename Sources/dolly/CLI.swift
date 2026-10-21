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

enum Output {
    /// One JSON object per invocation: `ok` plus the command's own fields.
    static func success(_ command: String, _ fields: [String: Any] = [:]) -> Never {
        var object: [String: Any] = ["ok": true, "command": command]
        object.merge(fields) { _, new in new }
        write(object)
        exit(Exit.ok.rawValue)
    }

    static func failure(_ error: Failure) -> Never {
        write(["ok": false, "error": error.message])
        exit(error.code.rawValue)
    }

    static func write(_ object: [String: Any]) {
        let data = (try? JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )) ?? Data("{\"ok\":false,\"error\":\"encode failed\"}".utf8)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

// MARK: - Arguments

/// Parsed arguments: positional values in order, `--flag value` and
/// `--flag=value` in a dictionary, so a repeated flag collects every value.
struct Args {
    var positional: [String] = []
    var flags: [String: [String]] = [:]

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
        Find.spec,
        Front.spec,
        Windows.spec,
        Trust.spec,
        Record.spec,
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

    static func requireTrust() throws {
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
        lines.append("Shared flags:")
        lines.append("  --guard <pid|bundle|name>  refuse to run unless that app is frontmost")
        lines.append("  --ms <n>                   travel time in milliseconds (default 700)")
        lines.append("  --ease inOut|out|inQuint|linear")
        lines.append("")
        lines.append("Every command prints one JSON object: {\"ok\":true,\"command\":...}.")
        lines.append("Exit codes: 0 ok, 2 usage, 3 refused, 4 untrusted, 5 failed.")
        return lines.joined(separator: "\n")
    }

    private static func pad(_ text: String, _ width: Int) -> String {
        text.padding(toLength: max(width, text.count), withPad: " ", startingAt: 0)
    }
}
