import Foundation

/// Entry point. Three routes, in order: service lifecycle, forwarding to a
/// running service, or running the verb in this process.
///
/// The forwarding step exists because macOS ties the Accessibility grant to a
/// process: a dolly started by an untrusted shell posts events that the window
/// server drops. A service started by launchd is its own responsible process
/// and always may.

let argv = Array(CommandLine.arguments.dropFirst())

func emit(_ data: Data) -> Never {
    Output.write(data)
    let text = String(decoding: data, as: UTF8.self)
    let code = (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        .flatMap { $0?["code"] as? Int } ?? 0
    exit(Int32(code))
}

switch argv.first {
case "serve":
    let parsed = (try? Args.parse(Array(argv.dropFirst()))) ?? Args()
    do {
        try Service.serve(path: parsed.string("socket") ?? Service.socketPath)
    } catch let failure as Failure {
        emit(Output.encode(command: "serve", result: Runner.Result(fields: ["error": failure.message], code: failure.code)))
    }
    emit(Output.encode(command: "serve", result: Runner.Result(fields: [:], code: .ok)))

case "service":
    let action = Array(argv.dropFirst()).first ?? "status"
    let result: Runner.Result
    do {
        switch action {
        case "start":
            result = Runner.Result(fields: try Service.start(), code: .ok)
        case "stop":
            result = Runner.Result(fields: Service.stop(), code: .ok)
        case "status":
            result = Runner.Result(fields: Service.status(), code: .ok)
        default:
            result = Runner.Result(fields: ["error": "service start|stop|status"], code: .usage)
        }
    } catch let failure as Failure {
        result = Runner.Result(fields: ["error": failure.message], code: failure.code)
    } catch {
        result = Runner.Result(fields: ["error": "\(error)"], code: .failed)
    }
    emit(Output.encode(command: "service", result: result))

default:
    // One attempt, no preflight: connecting is the cheap test for a service,
    // and a local run is the fallback when none answers.
    if ProcessInfo.processInfo.environment["DOLLY_LOCAL"] != "1",
       let forwarded = try? Service.forward(argv: argv, socket: Service.socketPath) {
        emit(forwarded)
    }
    emit(Output.encode(command: nil, result: Runner.run(argv: argv)))
}
