// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MacMediaEngine",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MacMediaEngineCore", targets: ["MacMediaEngineCore"]),
        .executable(name: "mac-media-engine", targets: ["MacMediaEngine"]),
        .executable(name: "mac-media-engine-contract-tests", targets: ["MacMediaEngineContractTests"]),
    ],
    targets: [
        .target(name: "MacMediaEngineCore"),
        .executableTarget(name: "MacMediaEngine", dependencies: ["MacMediaEngineCore"]),
        .executableTarget(
            name: "MacMediaEngineContractTests",
            dependencies: ["MacMediaEngineCore"],
            path: "Tests/MacMediaEngineCoreTests"
        ),
    ]
)
