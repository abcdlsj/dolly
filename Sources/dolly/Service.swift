import Foundation

/// A launchd-hosted input service.
///
/// macOS grants Accessibility to a process, not to a terminal, and a child of
/// an untrusted shell inherits the shell's identity — its events are dropped
/// without a word. `dolly service start` registers this binary with launchd,
/// which makes dolly its own responsible process, so every verb keeps working
/// no matter who calls it. Calls then travel over a UNIX socket.
enum Service {
    static let label = "dev.abcdlsj.dolly"

    static var socketPath: String {
        if let configured = ProcessInfo.processInfo.environment["DOLLY_SOCKET"], !configured.isEmpty {
            return configured
        }
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        return (caches ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("dolly/dolly.sock").path
    }

    // MARK: - Server

    /// Serves one request at a time, which is what a single pointer is anyway.
    static func serve(path: String) throws -> Never {
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        unlink(path)

        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { throw Failure("socket() failed", code: .failed) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            path.withCString { name in
                buffer.baseAddress?.copyMemory(from: name, byteCount: min(strlen(name), buffer.count - 1))
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, size) }
        }
        guard bound == 0, listen(listener, 8) == 0 else {
            throw Failure("cannot listen on \(path)", code: .failed)
        }

        while true {
            let client = accept(listener, nil, nil)
            guard client >= 0 else { continue }
            handle(client)
            close(client)
        }
    }

    private static func handle(_ client: Int32) {
        guard let line = readLine(client),
              let request = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let argv = request["argv"] as? [String] else {
            writeLine(client, Data("{\"code\":2,\"error\":\"bad request\",\"ok\":false}\n".utf8))
            return
        }
        let result = Runner.run(argv: argv)
        writeLine(client, Output.encode(command: result.fields["command"] as? String, result: result))
    }

    private static func readLine(_ fd: Int32) -> Data? {
        var buffer = Data()
        var byte: UInt8 = 0
        while read(fd, &byte, 1) == 1 {
            if byte == 0x0A { return buffer }
            buffer.append(byte)
            if buffer.count > 1 << 20 { return nil }
        }
        return buffer.isEmpty ? nil : buffer
    }

    private static func writeLine(_ fd: Int32, _ data: Data) {
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var sent = 0
            while sent < data.count {
                let written = write(fd, base.advanced(by: sent), data.count - sent)
                if written <= 0 { return }
                sent += written
            }
        }
    }

    // MARK: - Client

    /// Forwards one call to the service and returns its answer verbatim.
    static func forward(argv: [String], socket path: String) throws -> Data {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Failure("socket() failed", code: .failed) }
        defer { close(fd) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            path.withCString { name in
                buffer.baseAddress?.copyMemory(from: name, byteCount: min(strlen(name), buffer.count - 1))
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
        }
        guard connected == 0 else {
            throw Failure("no service at \(path); run dolly service start", code: .failed)
        }

        let request = try JSONSerialization.data(withJSONObject: ["argv": argv]) + Data("\n".utf8)
        writeLine(fd, request)
        guard let response = readLine(fd) else {
            throw Failure("service closed the connection", code: .failed)
        }
        return response + Data("\n".utf8)
    }

    /// Whether a service answers on the path, without spending an input.
    static func isRunning(socket path: String) -> Bool {
        (try? forward(argv: ["front"], socket: path)) != nil
    }

    // MARK: - Lifecycle

    static func start() throws -> [String: Any] {
        let path = socketPath
        let binary = Bundle.main.executablePath ?? CommandLine.arguments[0]
        launchctl(["remove", label])
        let submitted = launchctl(["submit", "-l", label, "--", binary, "serve", "--socket", path])
        guard submitted else { throw Failure("launchctl submit failed", code: .failed) }

        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if isRunning(socket: path) { return ["socket": path, "pid": pid(), "running": true] }
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw Failure("service did not answer on \(path)", code: .failed)
    }

    static func stop() -> [String: Any] {
        launchctl(["remove", label])
        return ["running": false]
    }

    static func status() -> [String: Any] {
        let path = socketPath
        return ["socket": path, "running": isRunning(socket: path), "pid": pid()]
    }

    private static func pid() -> Int {
        ServiceQuery.pid(label: label)
    }

    @discardableResult
    private static func launchctl(_ arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardError = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}

/// Reads a job's pid out of `launchctl list`.
enum ServiceQuery {
    static func pid(label: String) -> Int {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["list", label]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return 0 }
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(decoding: data, as: UTF8.self)
        for line in text.split(separator: "\n") where line.contains("\"PID\"") {
            let digits = line.filter(\.isNumber)
            if let value = Int(digits) { return value }
        }
        return 0
    }
}
