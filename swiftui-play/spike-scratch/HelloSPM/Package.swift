// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "HelloSPM",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "HelloSPM",
            path: "Sources/HelloSPM"
        )
    ]
)
