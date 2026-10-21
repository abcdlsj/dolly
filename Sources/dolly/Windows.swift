import CoreGraphics
import Foundation

/// Window lookup, so a caller can address a single window for capture and
/// aims its pointer at the window's own geometry.
struct WindowInfo {
    let id: Int
    let pid: pid_t
    let layer: Int
    let bounds: CGRect
    let name: String
    let onScreen: Bool

    var json: [String: Any] {
        [
            "id": id,
            "pid": Int(pid),
            "layer": layer,
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.width,
            "height": bounds.height,
            "name": name,
            "onScreen": onScreen,
        ]
    }
}

enum WindowList {
    static func list(pid: pid_t? = nil, layer: Int? = 0) -> [WindowInfo] {
        let options: CGWindowListOption = [.optionAll]
        guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        return raw.compactMap { entry -> WindowInfo? in
            guard let owner = entry[kCGWindowOwnerPID as String] as? pid_t else { return nil }
            if let pid, owner != pid { return nil }
            let depth = entry[kCGWindowLayer as String] as? Int ?? 0
            if let layer, depth != layer { return nil }
            guard let number = entry[kCGWindowNumber as String] as? Int,
                  let bounds = entry[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return nil }
            return WindowInfo(
                id: number,
                pid: owner,
                layer: depth,
                bounds: rect,
                name: entry[kCGWindowName as String] as? String ?? "",
                onScreen: (entry[kCGWindowIsOnscreen as String] as? Bool) ?? false
            )
        }
    }

    static func front() -> WindowInfo? {
        list().first { $0.onScreen && $0.bounds.width > 1 }
    }

    /// The frontmost window under a screen point: the one a click would land
    /// on. Used to refuse input aimed at the wrong app.
    static func at(_ point: Point) -> WindowInfo? {
        list().first { window in
            window.onScreen
                && window.layer == 0
                && window.bounds.contains(point.cg)
                && window.bounds.width > 1
        }
    }
}

/// The largest on-screen window of an app, the usual target for a film: it is
/// the window whose frame the pointer coordinates are relative to.
enum Target {
    static func pick(pid: pid_t, width: Int? = nil, height: Int? = nil) throws -> WindowInfo {
        let candidates = WindowList.list(pid: pid).filter { window in
            guard window.onScreen, window.layer == 0 else { return false }
            if let width, Int(window.bounds.width) != width { return false }
            if let height, Int(window.bounds.height) != height { return false }
            return true
        }
        let largest = { (window: WindowInfo) in window.bounds.width * window.bounds.height }
        guard let window = candidates.max(by: { largest($0) < largest($1) }) else {
            throw Failure("no window for pid \(pid)", code: .failed)
        }
        return window
    }
}
