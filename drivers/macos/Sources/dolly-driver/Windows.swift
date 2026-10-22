import CoreGraphics
import Foundation

/// The window list, front to back as the window server stacks them. Picking
/// a film's window and hit-testing the pointer happen in TypeScript.
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
}
