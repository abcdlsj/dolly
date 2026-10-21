import Foundation

/// Runs one verb and returns its result instead of printing it, so the same
/// code serves both a direct call and a forwarded one.
enum Runner {
    struct Result {
        let fields: [String: Any]
        let code: Exit
    }

    /// The command table is a value; nothing here touches the pointer unless a
    /// verb asks for it.
    static func run(argv: [String]) -> Result {
        guard let verb = argv.first, !verb.hasPrefix("--") else {
            return Result(fields: Help.payload, code: .ok)
        }
        guard let command = Registry.lookup(verb) else {
            return Result(fields: ["error": "unknown command \"\(verb)\"; run dolly help"], code: .usage)
        }
        do {
            let args = try Args.parse(Array(argv.dropFirst()))
            return Result(fields: try command.run(args), code: .ok)
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
