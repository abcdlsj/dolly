// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dolly-driver",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "dolly-driver", targets: ["dolly-driver"]),
    ],
    targets: [
        .executableTarget(
            name: "dolly-driver",
            path: "Sources/dolly-driver"
        ),
    ],
    // The driver shares state across the service's request threads through
    // locks, not actors; Swift 5 mode keeps that a warning, not an error.
    swiftLanguageModes: [.v5]
)
