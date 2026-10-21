// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dolly",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "dolly", targets: ["dolly"]),
    ],
    targets: [
        .executableTarget(
            name: "dolly",
            path: "Sources/dolly"
        ),
    ]
)
