import CoreGraphics
import Foundation

/// The verbs. Each one is small on purpose: read flags, check the guard, hand
/// the work to `Travel` or `Poster`, report what it did.

// MARK: - Shared parsing

enum Parsing {
    /// Accepts `dolly move 640 400` and `dolly move 640,400`.
    static func point(_ args: Args, startingAt index: Int) throws -> Point {
        if let single = args.positional[safe: index].flatMap(Point.parse) {
            return single
        }
        if let x = args.positional[safe: index].flatMap(Double.init),
           let y = args.positional[safe: index + 1].flatMap(Double.init) {
            return Point(x: x, y: y)
        }
        throw Failure("expected a point as x,y")
    }

    static func points(_ args: Args) throws -> [Point] {
        let parsed = args.positional.compactMap(Point.parse)
        guard parsed.count == args.positional.count, !parsed.isEmpty else {
            throw Failure("expected points as x,y")
        }
        return parsed
    }

    static func button(_ args: Args) -> CGMouseButton {
        switch args.string("button") ?? "left" {
        case "right": return .right
        case "middle", "center": return .center
        default: return .left
        }
    }

    static func modifiers(_ args: Args) -> CGEventFlags {
        var flags: CGEventFlags = []
        for name in args.strings("modifiers") {
            switch name.lowercased() {
            case "cmd", "command": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "alt", "option", "opt": flags.insert(.maskAlternate)
            case "ctrl", "control": flags.insert(.maskControl)
            default: break
            }
        }
        return flags
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// Travel duration shared by every moving verb.
enum Timing {
    static func milliseconds(_ args: Args, _ fallback: Int = 700) -> Int {
        max(args.int("ms", fallback), 0)
    }

    static func hold(_ seconds: Double) {
        if seconds > 0 { Thread.sleep(forTimeInterval: seconds) }
    }
}

// MARK: - move

enum Move {
    static let name = "move"
    static let summary = "move the pointer to a point"
    static let usage = "dolly move <x,y> [--ms n] [--ease inOut] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let target = try Parsing.point(args, startingAt: 0)
        return try travel([target], args)
    }

    static func travel(_ points: [Point], _ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        try Shared.guardFront(args)
        let poster = Shared.poster()
        let started = Date()
        Travel.run(poster, through: points, milliseconds: Timing.milliseconds(args), ease: Shared.ease(args))
        return [
            "to": points.map { ["x": $0.x, "y": $0.y] },
            "ms": Int(Date().timeIntervalSince(started) * 1000),
        ]
    }
}

// MARK: - path

enum Path {
    static let name = "path"
    static let summary = "move through several points in one eased travel"
    static let usage = "dolly path <x,y> <x,y> ... [--ms n] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let points = try Parsing.points(args)
        return try Move.travel(points, args)
    }
}

// MARK: - hover

enum Hover {
    static let name = "hover"
    static let summary = "move to a point and hold, so hover state settles"
    static let usage = "dolly hover <x,y> [--hold 1.2] [--nudge 1] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let target = try Parsing.point(args, startingAt: 0)
        var fields = try Move.travel([target], args)
        let hold = args.double("hold", 1.2)
        // A one-point wiggle after the move keeps a hover timer alive without
        // visibly moving the pointer.
        let nudge = args.double("nudge", 0)
        if nudge > 0 {
            let poster = Shared.poster()
            poster.move(to: Point(x: target.x + nudge, y: target.y))
            poster.move(to: target)
        }
        Timing.hold(hold)
        fields["held"] = hold
        return fields
    }
}

// MARK: - click

enum Click {
    static let name = "click"
    static let summary = "move to a point, press and release"
    static let usage = "dolly click <x,y> [--button left|right] [--count 1] [--ms n] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let target = try Parsing.point(args, startingAt: 0)
        var fields = try Move.travel([target], args)
        try Shared.requireTrust()
        let poster = Shared.poster()
        let button = Parsing.button(args)
        let count = max(args.int("count", 1), 1)
        let flags = Parsing.modifiers(args)
        for click in 1...count {
            if !flags.isEmpty {
                poster.key(code: 0, flags: flags)
            }
            poster.press(button, clicks: Int64(click))
            Timing.hold(0.03)
            poster.release(button, clicks: Int64(click))
            Timing.hold(0.06)
        }
        Timing.hold(args.double("hold", 0))
        fields["clicks"] = count
        return fields
    }
}

// MARK: - drag

enum Drag {
    static let name = "drag"
    static let summary = "press, travel while held, release (starts real drag sessions)"
    static let usage = "dolly drag <x,y> <x,y> [--via x,y] [--ms n] [--hold 0.6] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let start = try Parsing.point(args, startingAt: 0)
        let destination = try Parsing.point(args, startingAt: 1)
        let via = args.strings("via").compactMap(Point.parse)
        try Shared.requireTrust()
        try Shared.guardFront(args)

        let poster = Shared.poster()
        Travel.run(poster, through: [start], milliseconds: args.int("approach-ms", 450), ease: .inOut)
        Timing.hold(0.15)
        poster.press()
        Timing.hold(0.08)

        // Past the platform's drag threshold before the eased leg, otherwise
        // the press is read as a click.
        poster.drag(to: Point(x: start.x + 4, y: start.y + 4))
        Timing.hold(0.05)

        let hold = args.double("hold", 0.6)
        let travel = Timing.milliseconds(args, 900)
        Travel.run(poster, through: via + [destination], milliseconds: travel, ease: Shared.ease(args), dragging: true)
        // Held at the destination so a drop overlay is on screen long enough
        // to be cut and pushed in on.
        Timing.hold(hold)
        poster.release()
        return [
            "from": ["x": start.x, "y": start.y],
            "to": ["x": destination.x, "y": destination.y],
            "ms": travel,
            "held": hold,
        ]
    }
}

// MARK: - scroll

enum Scroll {
    static let name = "scroll"
    static let summary = "scroll the wheel at the current pointer position"
    static let usage = "dolly scroll <dy> [dx] [--unit line|pixel] [--times 1] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        try Shared.guardFront(args)
        let dy = args.positional[safe: 0].flatMap(Int32.init) ?? 0
        let dx = args.positional[safe: 1].flatMap(Int32.init) ?? 0
        let unit: CGScrollEventUnit = (args.string("unit") ?? "line") == "pixel" ? .pixel : .line
        let times = max(args.int("times", 1), 1)
        let poster = Shared.poster()
        for _ in 0..<times {
            poster.scroll(dy: dy, dx: dx, unit: unit)
            Timing.hold(args.double("interval", 0.05))
        }
        return ["dy": Int(dy), "dx": Int(dx), "times": times]
    }
}

// MARK: - key

enum Key {
    static let name = "key"
    static let summary = "press a virtual key code"
    static let usage = "dolly key <code> [--modifiers cmd,shift] [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        try Shared.guardFront(args)
        guard let raw = args.positional[safe: 0].flatMap(UInt16.init) else {
            throw Failure("expected a virtual key code")
        }
        Shared.poster().key(code: CGKeyCode(raw), flags: Parsing.modifiers(args))
        return ["key": Int(raw)]
    }
}

// MARK: - type

enum Type {
    static let name = "type"
    static let summary = "type text into the focused control"
    static let usage = "dolly type <text> [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        try Shared.guardFront(args)
        let text = args.positional.joined(separator: " ")
        Shared.poster().type(text)
        return ["characters": text.count]
    }
}

// MARK: - press / find

enum Press {
    static let name = "press"
    static let summary = "press a control through accessibility, by its label"
    static let usage = "dolly press <pid> <label> [--guard app]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        try Shared.requireTrust()
        try Shared.guardFront(args)
        guard let pid = args.positional[safe: 0].flatMap(Int32.init),
              let label = args.positional[safe: 1] else {
            throw Failure("expected a pid and a label")
        }
        try Accessibility.press(pid: pid, label: label)
        return ["pid": Int(pid), "label": label]
    }
}

enum Find {
    static let name = "find"
    static let summary = "list controls whose label matches, to aim a press"
    static let usage = "dolly find <pid> <label>"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard let pid = args.positional[safe: 0].flatMap(Int32.init),
              let label = args.positional[safe: 1] else {
            throw Failure("expected a pid and a label")
        }
        let matches = Accessibility.matches(pid: pid, label: label).map(Accessibility.describe)
        return ["count": matches.count, "matches": matches]
    }
}

// MARK: - front / windows / trust

enum Front {
    static let name = "front"
    static let summary = "report the frontmost app"
    static let usage = "dolly front"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard let front = FrontApp.describe() else { throw Failure("no frontmost app", code: .failed) }
        return ["pid": Int(front.pid), "name": front.name, "bundle": front.bundle]
    }
}

enum Windows {
    static let name = "windows"
    static let summary = "list windows with ids and frames"
    static let usage = "dolly windows [--pid n] [--layer 0|--any-layer]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        let pid = args.string("pid").flatMap(Int32.init)
        let layer = args.flag("any-layer") ? nil : args.int("layer", 0)
        let windows = WindowList.list(pid: pid, layer: layer).map(\.json)
        return ["count": windows.count, "windows": windows]
    }
}

enum Trust {
    static let name = "trust"
    static let summary = "report Accessibility trust, optionally ask for it"
    static let usage = "dolly trust [--prompt [--wait 60]]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard args.flag("prompt") else { return ["trusted": Accessibility.trusted()] }
        // The system prompt is attributed to this process, so stay alive while
        // it is on screen; exiting closes it before the grant is recorded.
        Accessibility.requestTrust()
        let deadline = Date().addingTimeInterval(args.double("wait", 60))
        var waited = 0.0
        while Date() < deadline, !Accessibility.trusted() {
            Thread.sleep(forTimeInterval: 0.5)
            waited += 0.5
        }
        return ["trusted": Accessibility.trusted(), "waited": waited]
    }
}

// MARK: - record

enum Record {
    static let name = "record"
    static let summary = "capture window-only frames for a camera move"
    static let usage = "dolly record <windowID> <dir> <seconds> [--loops 4]"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    static func run(_ args: Args) throws -> [String: Any] {
        guard let windowID = args.positional[safe: 0].flatMap(Int.init),
              let directory = args.positional[safe: 1].map({ URL(fileURLWithPath: $0) }),
              let seconds = args.positional[safe: 2].flatMap(Double.init) else {
            throw Failure("expected a window id, a directory and a duration")
        }
        let loops = args.int("loops", 4)
        let result = try Capture.frames(
            windowID: windowID,
            directory: directory,
            seconds: seconds,
            loops: loops
        )
        return [
            "window": windowID,
            "directory": directory.path,
            "frames": result.count,
            "seconds": (result.duration * 1000).rounded() / 1000,
            "fps": result.duration > 0 ? ((Double(result.count) / result.duration) * 10).rounded() / 10 : 0,
        ]
    }
}

// MARK: - help

enum Help {
    static let name = "help"
    static let summary = "print this text"
    static let usage = "dolly help"
    static let spec = Command(name: name, summary: summary, usage: usage, run: run)

    /// Help is one JSON object too: agents read `commands`, people read
    /// `text` (see `scripts/dolly help | jq -r .text`).
    static var payload: [String: Any] {
        ["text": Usage.text(), "commands": Registry.all.map(\.name)]
    }

    static func run(_ args: Args) throws -> [String: Any] {
        payload
    }
}
