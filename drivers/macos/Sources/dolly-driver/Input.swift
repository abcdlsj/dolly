import CoreGraphics
import Foundation

/// Plays the input timelines dolly plans in TypeScript (`InputStep` in
/// packages/protocol) as real HID events.

// MARK: - Timeline

enum Timeline {
    /// Steps fire on the wall clock measured from the first one. A late
    /// `move` or `drag` is dropped when the next step is also a pointer move
    /// that is already due, so a slow event tap never stretches a gesture;
    /// presses, releases and keys always post.
    static func play(_ raw: [[String: Any]]) throws -> [String: Any] {
        let steps = try raw.map(Step.init).sorted { $0.ms < $1.ms }
        let poster = Poster()
        let started = Date()
        var posted = 0
        var dropped = 0
        for (index, step) in steps.enumerated() {
            let due = started.addingTimeInterval(step.ms / 1000)
            let wait = due.timeIntervalSinceNow
            if wait > 0 {
                Thread.sleep(forTimeInterval: wait)
            } else if step.isPointerMove, index + 1 < steps.count {
                let next = steps[index + 1]
                if next.isPointerMove, started.addingTimeInterval(next.ms / 1000) <= Date() {
                    dropped += 1
                    continue
                }
            }
            poster.post(step)
            posted += 1
        }
        return ["posted": posted, "dropped": dropped, "ms": Int(Date().timeIntervalSince(started) * 1000)]
    }

    struct Step {
        let ms: Double
        let type: String
        let fields: Params

        init(_ raw: [String: Any]) throws {
            fields = Params(raw: raw)
            ms = try fields.double("ms")
            type = try fields.string("type")
        }

        var isPointerMove: Bool { type == "move" || type == "drag" }
    }
}

// MARK: - Events

/// Posts real HID events. Needs Accessibility trust; without it the window
/// server drops them silently, so the CLI checks trust first.
final class Poster {
    private let source = CGEventSource(stateID: .hidSystemState)
    private var cursor: CGPoint
    /// AppKit's drag machinery expects each event to carry a new number;
    /// events that all share number 0 are treated as repeats of one gesture.
    private var eventNumber: Int64 = 0

    init() {
        cursor = CGEvent(source: nil)?.location ?? .zero
        CGAssociateMouseAndMouseCursorPosition(1)
    }

    func post(_ step: Timeline.Step) {
        let f = step.fields
        switch step.type {
        case "move", "drag":
            let point = CGPoint(x: f.double("x", Double(cursor.x)), y: f.double("y", Double(cursor.y)))
            pointer(to: point, type: step.type == "drag" ? .leftMouseDragged : .mouseMoved)
        case "down", "up":
            button(
                Poster.button(f.raw["button"] as? String),
                down: step.type == "down",
                clicks: Int64(f.double("clicks", 1)),
                flags: Poster.flags(f.strings("modifiers"))
            )
        case "scroll":
            scroll(
                dy: Int32(f.double("dy", 0)),
                dx: Int32(f.double("dx", 0)),
                unit: (f.raw["unit"] as? String) == "pixel" ? .pixel : .line
            )
        case "key":
            key(code: CGKeyCode(f.double("code", 0)), down: f.bool("down", true), flags: Poster.flags(f.strings("modifiers")))
        case "text":
            type((f.raw["text"] as? String) ?? "")
        default:
            break
        }
    }

    private func nextNumber() -> Int64 {
        eventNumber += 1
        return eventNumber
    }

    private func pointer(to point: CGPoint, type: CGEventType) {
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: .left
        ) else { return }
        event.setIntegerValueField(.mouseEventDeltaX, value: Int64((point.x - cursor.x).rounded()))
        event.setIntegerValueField(.mouseEventDeltaY, value: Int64((point.y - cursor.y).rounded()))
        event.setIntegerValueField(.mouseEventNumber, value: nextNumber())
        event.post(tap: .cghidEventTap)
        cursor = point
    }

    private func button(_ kind: CGMouseButton, down: Bool, clicks: Int64, flags: CGEventFlags) {
        let type: CGEventType
        switch kind {
        case .right: type = down ? .rightMouseDown : .rightMouseUp
        case .left: type = down ? .leftMouseDown : .leftMouseUp
        default: type = down ? .otherMouseDown : .otherMouseUp
        }
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: cursor,
            mouseButton: kind
        ) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: clicks)
        event.setIntegerValueField(.mouseEventNumber, value: nextNumber())
        // Modifiers ride on the press itself: a separate chord would type into
        // whatever has focus instead of modifying the click.
        if !flags.isEmpty { event.flags = flags }
        event.post(tap: .cghidEventTap)
    }

    private func scroll(dy: Int32, dx: Int32, unit: CGScrollEventUnit) {
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

    private func key(code: CGKeyCode, down: Bool, flags: CGEventFlags) {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }

    /// Unicode typing, independent of the keyboard layout: every character
    /// rides on a key event of its own.
    private func type(_ text: String) {
        for scalar in text.utf16 {
            var unit = scalar
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
                event.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
                event.post(tap: .cghidEventTap)
            }
            usleep(2_000)
        }
    }

    static func button(_ name: String?) -> CGMouseButton {
        switch name {
        case "right": return .right
        case "middle": return .center
        default: return .left
        }
    }

    static func flags(_ names: [String]) -> CGEventFlags {
        var flags: CGEventFlags = []
        for name in names {
            switch name {
            case "cmd": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "alt": flags.insert(.maskAlternate)
            case "ctrl": flags.insert(.maskControl)
            default: break
            }
        }
        return flags
    }
}
