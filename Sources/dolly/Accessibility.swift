import ApplicationServices
import Foundation

/// Control discovery and pressing through the accessibility tree: the route
/// for controls a click cannot reach (menu items, toolbar buttons, rows
/// behind a hover) and for verifying that a label exists before filming it.
enum Accessibility {
    static func trusted() -> Bool {
        AXIsProcessTrusted()
    }

    /// Asks macOS to show the Accessibility prompt for this binary.
    static func requestTrust() {
        _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    }

    static func press(pid: pid_t, label: String) throws {
        guard let element = matches(pid: pid, label: label).first else {
            throw Failure("no control labelled \"\(label)\" in pid \(pid)", code: .failed)
        }
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        guard result == .success else {
            throw Failure("press \"\(label)\" failed with AXError \(result.rawValue)", code: .failed)
        }
    }

    /// Every element whose title, description, help or value equals `label`,
    /// case-insensitively.
    static func matches(pid: pid_t, label: String) -> [AXUIElement] {
        var found: [AXUIElement] = []
        walk(AXUIElementCreateApplication(pid), depth: 0, label: label.lowercased(), into: &found)
        return found
    }

    /// Brings an app forward through accessibility. `NSRunningApplication` and
    /// System Events both go through LaunchServices, which refuses for a binary
    /// that is not a registered app bundle; AX activation works for any process
    /// that has a window.
    static func activate(pid: pid_t) throws {
        let app = AXUIElementCreateApplication(pid)
        let error = AXUIElementSetAttributeValue(
            app,
            kAXFrontmostAttribute as CFString,
            kCFBooleanTrue
        )
        guard error == .success else {
            throw Failure("cannot focus pid \(pid): AXError \(error.rawValue)", code: .failed)
        }
    }

    /// Every control AX exposes under a pid, for aiming a press when the exact
    /// label is unknown.
    static func controls(pid: pid_t, role: String) -> [String] {
        var found: [AXUIElement] = []
        collect(AXUIElementCreateApplication(pid), depth: 0, role: role, into: &found)
        return found.map(describe)
    }

    private static func collect(_ element: AXUIElement, depth: Int, role: String, into found: inout [AXUIElement]) {
        guard depth < 80, found.count < 400 else { return }
        if string(element, kAXRoleAttribute) == role { found.append(element) }
        for child in children(element) {
            collect(child, depth: depth + 1, role: role, into: &found)
        }
    }

    /// Resizes an app's main window: a film wants a big canvas so split panes
    /// still read.
    static func resize(pid: pid_t, width: Double, height: Double) throws {
        guard let window = mainWindow(pid: pid) else {
            throw Failure("no window for pid \(pid)", code: .failed)
        }
        var size = CGSize(width: width, height: height)
        guard let axial = AXValueCreate(.cgSize, &size) else {
            throw Failure("cannot build a size", code: .failed)
        }
        let result = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, axial)
        guard result == .success else {
            throw Failure("cannot resize window: AXError \(result.rawValue)", code: .failed)
        }
    }

    private static func mainWindow(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
              let windows = value as? [AXUIElement] else { return nil }
        return windows.first
    }

    /// Moves an app's main window, so a recording can happen on a display
    /// nothing else is using.
    static func place(pid: pid_t, at point: Point) throws {
        let app = AXUIElementCreateApplication(pid)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
              let windows = value as? [AXUIElement],
              let window = windows.first else {
            throw Failure("no window for pid \(pid)", code: .failed)
        }
        var position = CGPoint(x: point.x, y: point.y)
        guard let axial = AXValueCreate(.cgPoint, &position) else {
            throw Failure("cannot build a point", code: .failed)
        }
        let result = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, axial)
        guard result == .success else {
            throw Failure("cannot move window: AXError \(result.rawValue)", code: .failed)
        }
    }

    static func describe(_ element: AXUIElement) -> String {
        [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute]
            .compactMap { string(element, $0) }
            .joined(separator: " | ")
    }

    /// Up to 60 levels deep, capped at 8 hits: enough for a window's chrome,
    /// bounded so a huge tree cannot stall a recording.
    private static func walk(_ element: AXUIElement, depth: Int, label: String, into found: inout [AXUIElement]) {
        guard depth < 60, found.count < 8 else { return }
        let attributes = [
            kAXTitleAttribute,
            kAXDescriptionAttribute,
            kAXHelpAttribute,
            kAXValueAttribute,
        ]
        if attributes.contains(where: { string(element, $0)?.lowercased() == label }) {
            found.append(element)
            return
        }
        for child in children(element) {
            walk(child, depth: depth + 1, label: label, into: &found)
            if found.count >= 8 { return }
        }
    }

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let text = value as? String, !text.isEmpty else { return nil }
        return text
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
              let list = value as? [AXUIElement] else { return [] }
        return list
    }
}
