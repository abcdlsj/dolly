import AppKit

/// The app the user is looking at. Every input verb can be guarded against it
/// so a stray event never lands on someone else's window.
enum FrontApp {
    struct Description {
        let pid: pid_t
        let name: String
        let bundle: String
    }

    static func describe() -> Description? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        return Description(
            pid: app.processIdentifier,
            name: app.localizedName ?? "",
            bundle: app.bundleIdentifier ?? ""
        )
    }
}
