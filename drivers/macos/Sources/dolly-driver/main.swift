import Foundation

/// dolly-driver: the macOS side of dolly. It does only what needs the
/// platform (packages/protocol lists the ops); the `dolly` CLI does the rest.
///
///   dolly-driver call                        one request on stdin, one response on stdout
///   dolly-driver serve [--socket path]       the service loop, as launchd runs it
///   dolly-driver service start|stop|status [--socket path]

let argv = Array(CommandLine.arguments.dropFirst())

func flag(_ name: String) -> String? {
    guard let index = argv.firstIndex(of: "--\(name)"), index + 1 < argv.count else { return nil }
    return argv[index + 1]
}

func finish(_ data: Data) -> Never {
    FileHandle.standardOutput.write(data)
    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    exit(Int32((object?["code"] as? Int) ?? 0))
}

switch argv.first {
case "call":
    let line = FileHandle.standardInput.readDataToEndOfFile()
        .split(separator: 0x0A, omittingEmptySubsequences: true).first.map { Data($0) } ?? Data()
    finish(Ops.handle(line))

case "serve":
    do {
        try Service.serve(path: Service.socketPath(flag("socket")))
    } catch let failure as Failure {
        finish(Wire.encode(.failure(failure)))
    } catch {
        finish(Wire.encode(.failure(Failure("\(error)"))))
    }

case "service":
    let path = Service.socketPath(flag("socket"))
    let action = argv.dropFirst().first { !$0.hasPrefix("--") } ?? "status"
    let result: Result<[String: Any], Failure>
    do {
        switch action {
        case "start": result = .success(try Service.start(socket: path))
        case "stop": result = .success(Service.stop())
        case "status": result = .success(Service.status(socket: path))
        default: result = .failure(Failure("service start|stop|status", code: .usage))
        }
    } catch let failure as Failure {
        result = .failure(failure)
    } catch {
        result = .failure(Failure("\(error)"))
    }
    finish(Wire.encode(result))

default:
    finish(Wire.encode(.failure(Failure("usage: dolly-driver call | serve [--socket path] | service start|stop|status", code: .usage))))
}
