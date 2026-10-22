import Foundation

/// Runs one verb and returns its result instead of printing it, so the same
/// code serves both a direct call and a forwarded one.
enum Runner {
    struct Result {
        let fields: [String: Any]
        let code: Exit
    }

    /// Verbs that move the one pointer or type into the one focus. The service
    /// runs requests side by side, so a take can record while it is driven;
    /// these still go one at a time.
    static let inputVerbs: Set<String> = [
        "move", "path", "hover", "click", "drag", "scroll", "key", "type", "press",
        "place", "resize", "focus",
    ]
    private static let inputLock = NSLock()

    /// The command table is a value; nothing here touches the pointer unless a
    /// verb asks for it.
    static func run(argv: [String], cwd: String? = nil) -> Result {
        guard let verb = argv.first, !verb.hasPrefix("--") else {
            return Result(fields: Help.payload, code: .ok)
        }
        guard let command = Registry.lookup(verb) else {
            return Result(fields: ["error": "unknown command \"\(verb)\"; run dolly help"], code: .usage)
        }
        do {
            var args = try Args.parse(Array(argv.dropFirst()))
            args.cwd = cwd ?? FileManager.default.currentDirectoryPath
            let serial = inputVerbs.contains(verb)
            if serial { inputLock.lock() }
            defer { if serial { inputLock.unlock() } }
            let started = Date()
            let fields = try command.run(args)
            EventLog.note(verb: verb, started: started, ended: Date(), fields: fields)
            return Result(fields: fields, code: .ok)
        } catch let failure as Failure {
            return Result(fields: ["error": failure.message], code: failure.code)
        } catch {
            return Result(fields: ["error": "\(error)"], code: .failed)
        }
    }
}

enum Output {
    /// One JSON object per invocation: `ok` first in the alphabet, plus the
    /// command's own fields.
    static func encode(command: String?, result: Runner.Result) -> Data {
        var object: [String: Any] = ["ok": result.code == .ok, "code": result.code.rawValue]
        object.merge(result.fields) { _, new in new }
        if let command { object["command"] = command }
        let data = (try? JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )) ?? Data("{\"ok\":false,\"error\":\"encode failed\"}".utf8)
        return data + Data("\n".utf8)
    }

    static func write(_ data: Data) {
        FileHandle.standardOutput.write(data)
    }
}
