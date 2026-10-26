import AppKit
import Foundation

/// Every op of packages/protocol, mapped to the code that does it. Nothing
/// here decides anything a user would see: guards, curves and timing are
/// planned in TypeScript and arrive as params.
enum Ops {
    /// Ops that touch the one pointer, the keyboard focus or window layout
    /// (SERIAL_OPS in the protocol). The service runs requests side by side,
    /// so a capture can record while the take is driven; these go one at a time.
    static let serial: Set<String> = ["input", "press", "activate", "place", "resize"]
    private static let serialLock = NSLock()

    static func handle(_ line: Data) -> Data {
        do {
            let (op, params) = try Wire.decode(line)
            let isSerial = serial.contains(op)
            if isSerial { serialLock.lock() }
            defer { if isSerial { serialLock.unlock() } }
            return Wire.encode(.success(try run(op, params)))
        } catch let failure as Failure {
            return Wire.encode(.failure(failure))
        } catch {
            return Wire.encode(.failure(Failure("\(error)")))
        }
    }

    static func run(_ op: String, _ p: Params) throws -> [String: Any] {
        switch op {
        case "trust":
            if p.bool("screen") {
                // Screen Recording is granted per process like Accessibility,
                // and checked against the binary itself, so a rebuild can need
                // it again while Accessibility carries over.
                guard p.bool("prompt") else { return ["trusted": CGPreflightScreenCaptureAccess()] }
                _ = CGRequestScreenCaptureAccess()
                let deadline = Date().addingTimeInterval(p.double("wait", 60))
                var waited = 0.0
                while Date() < deadline, !CGPreflightScreenCaptureAccess() {
                    Thread.sleep(forTimeInterval: 0.5)
                    waited += 0.5
                }
                return ["trusted": CGPreflightScreenCaptureAccess(), "waited": waited]
            }
            guard p.bool("prompt") else { return ["trusted": Accessibility.trusted()] }
            // The system prompt is attributed to this process, so stay alive
            // while it is on screen; exiting closes it before the grant lands.
            Accessibility.requestTrust()
            let deadline = Date().addingTimeInterval(p.double("wait", 60))
            var waited = 0.0
            while Date() < deadline, !Accessibility.trusted() {
                Thread.sleep(forTimeInterval: 0.5)
                waited += 0.5
            }
            return ["trusted": Accessibility.trusted(), "waited": waited]

        case "front":
            guard let app = NSWorkspace.shared.frontmostApplication else { throw Failure("no frontmost app") }
            return Apps.describe(app)

        case "windows":
            let pid: pid_t? = try p.has("pid") ? p.pid() : nil
            // A missing layer means the normal window layer; null means every layer.
            let layer: Int? = p.raw["layer"] is NSNull ? nil : Int(p.double("layer", 0))
            return ["windows": WindowList.list(pid: pid, layer: layer).map(\.json)]

        case "pointer":
            let location = CGEvent(source: nil)?.location ?? .zero
            return ["x": Double(location.x), "y": Double(location.y)]

        case "input":
            return try Timeline.play(try p.list("steps"))

        case "find":
            let matches = Accessibility.matches(pid: try p.pid(), label: try p.string("label"))
            return ["matches": matches.map(Accessibility.describe)]

        case "press":
            return ["pressed": try Accessibility.press(pid: try p.pid(), label: try p.string("label"))]

        case "controls":
            return ["controls": Accessibility.controls(pid: try p.pid(), role: try p.string("role"))]

        case "tree":
            guard let within = p.raw["within"] as? [NSNumber], within.count == 4 else {
                throw Failure("within wants [x, y, width, height]", code: .usage)
            }
            let frame = CGRect(
                x: within[0].doubleValue, y: within[1].doubleValue,
                width: within[2].doubleValue, height: within[3].doubleValue
            )
            let result = Accessibility.tree(
                pid: try p.pid(),
                within: frame,
                depth: Int(p.double("depth", 40)),
                limit: Int(p.double("limit", 600)),
                menus: p.bool("menus")
            )
            return ["nodes": result.nodes, "truncated": result.truncated]

        case "activate":
            try Accessibility.activate(pid: try p.pid())
            if let app = NSWorkspace.shared.frontmostApplication { return ["front": Apps.describe(app)] }
            return ["front": NSNull()]

        case "place":
            try Accessibility.place(pid: try p.pid(), at: CGPoint(x: try p.double("x"), y: try p.double("y")))
            return [:]

        case "resize":
            try Accessibility.resize(pid: try p.pid(), width: try p.double("width"), height: try p.double("height"))
            return [:]

        case "video":
            return try Capture.video(windowID: try p.int("window"), file: URL(fileURLWithPath: try p.string("file")), seconds: try p.double("seconds"))

        case "frames":
            return try Capture.frames(
                windowID: try p.int("window"),
                directory: URL(fileURLWithPath: try p.string("directory")),
                seconds: try p.double("seconds"),
                loops: Int(p.double("loops", 4))
            )

        case "still":
            return try Capture.still(windowID: try p.int("window"), file: URL(fileURLWithPath: try p.string("file")), longest: Int(p.double("max", 0)))

        case "stitch":
            let crop = (p.raw["crop"] as? [NSNumber])?.map(\.intValue)
            let trim = (p.raw["trim"] as? [NSNumber])?.map(\.intValue) ?? [0, 0]
            return try Stitch.run(
                files: p.strings("files"),
                crop: crop,
                trim: (trim.first ?? 0, trim.count > 1 ? trim[1] : trim.first ?? 0),
                out: p.has("out") ? try p.string("out") : nil,
                chrome: p.bool("chrome")
            )

        case "launch":
            return try Apps.launch(
                target: try p.string("app"),
                arguments: p.strings("args"),
                environment: p.dictionary("environment"),
                fresh: p.bool("fresh")
            )

        case "quit":
            return Apps.quit(pid: try p.pid(), force: p.bool("force"), wait: p.double("wait", 5))

        default:
            throw Failure("unknown op \"\(op)\"", code: .usage)
        }
    }
}
