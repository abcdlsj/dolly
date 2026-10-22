import Foundation

/// The wire format of packages/protocol: one JSON object per line each way.
/// Requests are `{"op": …, …params}`; responses are `{"ok": true, …result}`
/// or `{"ok": false, "code": n, "error": "…"}`.

/// Exit codes are part of the contract so a caller can branch without
/// parsing text.
enum Exit: Int {
    case ok = 0
    case usage = 2
    case refused = 3
    case untrusted = 4
    case failed = 5
}

struct Failure: Error {
    let code: Exit
    let message: String
    init(_ message: String, code: Exit = .failed) {
        self.message = message
        self.code = code
    }
}

/// A request's params with typed accessors that throw a usage failure.
struct Params {
    let raw: [String: Any]

    func has(_ key: String) -> Bool {
        if let value = raw[key] { return !(value is NSNull) }
        return false
    }

    func double(_ key: String) throws -> Double {
        guard let value = raw[key] as? NSNumber else { throw Failure("\(key) wants a number", code: .usage) }
        return value.doubleValue
    }

    func double(_ key: String, _ fallback: Double) -> Double {
        (raw[key] as? NSNumber)?.doubleValue ?? fallback
    }

    func int(_ key: String) throws -> Int {
        Int(try double(key))
    }

    func pid(_ key: String = "pid") throws -> pid_t {
        pid_t(try int(key))
    }

    func string(_ key: String) throws -> String {
        guard let value = raw[key] as? String else { throw Failure("\(key) wants a string", code: .usage) }
        return value
    }

    func bool(_ key: String, _ fallback: Bool = false) -> Bool {
        (raw[key] as? Bool) ?? fallback
    }

    func strings(_ key: String) -> [String] {
        (raw[key] as? [String]) ?? []
    }

    func dictionary(_ key: String) -> [String: String] {
        (raw[key] as? [String: String]) ?? [:]
    }

    func list(_ key: String) throws -> [[String: Any]] {
        guard let value = raw[key] as? [[String: Any]] else { throw Failure("\(key) wants a list", code: .usage) }
        return value
    }
}

enum Wire {
    static func decode(_ line: Data) throws -> (op: String, params: Params) {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let op = object["op"] as? String else {
            throw Failure("bad request: want one JSON object with an op", code: .usage)
        }
        return (op, Params(raw: object))
    }

    static func encode(_ result: Result<[String: Any], Failure>) -> Data {
        var object: [String: Any]
        switch result {
        case let .success(fields):
            object = fields
            object["ok"] = true
        case let .failure(failure):
            object = ["ok": false, "code": failure.code.rawValue, "error": failure.message]
        }
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]))
            ?? Data("{\"code\":5,\"error\":\"encode failed\",\"ok\":false}".utf8)
        return data + Data("\n".utf8)
    }
}
