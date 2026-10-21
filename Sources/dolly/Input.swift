import CoreGraphics
import Foundation

/// Eased pointer travel and the raw event primitives every command builds on.

// MARK: - Easing

enum Ease: String, CaseIterable {
    case linear
    case inOut
    case out
    case inQuint

    /// Maps progress `0...1` onto eased progress. `inOut` is the default for
    /// camera-like moves; `out` suits a single settle.
    func value(_ progress: Double) -> Double {
        let t = min(max(progress, 0), 1)
        switch self {
        case .linear:
            return t
        case .inOut:
            return t * t * (3 - 2 * t)
        case .out:
            let rest = 1 - t
            return 1 - rest * rest * rest
        case .inQuint:
            return t * t * t * t * t
        }
    }
}

// MARK: - Points

/// Screen geometry in the global coordinate space CGEvent uses: origin at the
/// main display's top-left, points (not pixels).
struct Point {
    var x: Double
    var y: Double

    var cg: CGPoint { CGPoint(x: x, y: y) }

    /// Accepts `x,y` or `x y` so an agent can pass either from a shell.
    static func parse(_ text: String) -> Point? {
        let parts = text.split(whereSeparator: { $0 == "," || $0 == " " }).compactMap { Double($0) }
        guard parts.count == 2 else { return nil }
        return Point(x: parts[0], y: parts[1])
    }

    static func lerp(_ a: Point, _ b: Point, _ t: Double) -> Point {
        Point(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }

    func distance(to other: Point) -> Double {
        ((x - other.x) * (x - other.x) + (y - other.y) * (y - other.y)).squareRoot()
    }
}

// MARK: - Events

/// Posts real HID events. Needs Accessibility trust; events are dropped
/// silently without it, so callers check trust first.
final class Poster {
    private let source = CGEventSource(stateID: .hidSystemState)
    private(set) var cursor: Point

    init() {
        let location = CGEvent(source: nil)?.location ?? .zero
        cursor = Point(x: location.x, y: location.y)
        CGAssociateMouseAndMouseCursorPosition(1)
    }

    func move(to point: Point) {
        let deltaX = Int64((point.x - cursor.x).rounded())
        let deltaY = Int64((point.y - cursor.y).rounded())
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: .mouseMoved,
            mouseCursorPosition: point.cg,
            mouseButton: .left
        ) else { return }
        event.setIntegerValueField(.mouseEventDeltaX, value: deltaX)
        event.setIntegerValueField(.mouseEventDeltaY, value: deltaY)
        event.post(tap: .cghidEventTap)
        cursor = point
    }

    func press(_ kind: CGMouseButton = .left, clicks: Int64 = 1) {
        post(kind.isRight ? .rightMouseDown : .leftMouseDown, kind: kind, clicks: clicks)
    }

    func release(_ kind: CGMouseButton = .left, clicks: Int64 = 1) {
        post(kind.isRight ? .rightMouseUp : .leftMouseUp, kind: kind, clicks: clicks)
    }

    func drag(to point: Point) {
        let deltaX = Int64((point.x - cursor.x).rounded())
        let deltaY = Int64((point.y - cursor.y).rounded())
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: point.cg,
            mouseButton: .left
        ) else { return }
        event.setIntegerValueField(.mouseEventDeltaX, value: deltaX)
        event.setIntegerValueField(.mouseEventDeltaY, value: deltaY)
        event.post(tap: .cghidEventTap)
        cursor = point
    }

    func scroll(dy: Int32, dx: Int32, unit: CGScrollEventUnit) {
        guard let event = CGEvent(
            scrollWheelEvent2Source: source,
            units: unit,
            wheelCount: 2,
            wheel1: dy,
            wheel2: dx,
            wheel3: 0
        ) else { return }
        event.post(tap: .cghidEventTap)
    }

    func key(code: CGKeyCode, flags: CGEventFlags) {
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { continue }
            event.flags = flags
            event.post(tap: .cghidEventTap)
            usleep(8_000)
        }
    }

    func type(_ text: String) {
        for scalar in text.unicodeScalars {
            var unit = UniChar(scalar.value)
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
                event.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
                event.post(tap: .cghidEventTap)
            }
            usleep(2_000)
        }
    }

    private func post(_ type: CGEventType, kind: CGMouseButton, clicks: Int64) {
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: cursor.cg,
            mouseButton: kind
        ) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: clicks)
        event.post(tap: .cghidEventTap)
    }
}

extension CGMouseButton {
    var isRight: Bool { self == .right }
}

// MARK: - Travel

/// Moves the pointer along a polyline on an eased clock, posting an event
/// every few milliseconds so hover state, cursors and drag sessions all see
/// the journey instead of a jump.
enum Travel {
    /// Minimum spacing between events. Posting to the HID tap costs a few
    /// milliseconds on its own, so the loop is paced by wall clock: the move
    /// takes the time it was asked for even when events are slow.
    static let stepMilliseconds = 4.0

    static func run(
        _ poster: Poster,
        through path: [Point],
        milliseconds: Int,
        ease: Ease,
        dragging: Bool = false
    ) {
        let stops = [poster.cursor] + path
        var cumulative = [0.0]
        for index in 1..<stops.count {
            cumulative.append(cumulative[index - 1] + stops[index - 1].distance(to: stops[index]))
        }
        guard let total = cumulative.last, total > 0, !path.isEmpty else { return }

        let duration = Double(max(milliseconds, 0)) / 1000
        let started = Date()
        while true {
            let elapsed = Date().timeIntervalSince(started)
            let progress = duration > 0 ? min(elapsed / duration, 1) : 1
            let point = position(
                at: ease.value(progress) * total,
                stops: stops,
                cumulative: cumulative
            )
            if dragging { poster.drag(to: point) } else { poster.move(to: point) }
            if progress >= 1 { break }
            Thread.sleep(forTimeInterval: stepMilliseconds / 1000)
        }
        if let last = path.last {
            if dragging { poster.drag(to: last) } else { poster.move(to: last) }
        }
    }

    private static func position(at distance: Double, stops: [Point], cumulative: [Double]) -> Point {
        for index in 1..<stops.count where distance <= cumulative[index] {
            let span = cumulative[index] - cumulative[index - 1]
            let local = span > 0 ? (distance - cumulative[index - 1]) / span : 1
            return Point.lerp(stops[index - 1], stops[index], local)
        }
        return stops.last ?? stops[0]
    }
}
