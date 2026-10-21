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
