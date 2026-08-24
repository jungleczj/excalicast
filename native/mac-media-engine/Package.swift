// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MacMediaEngine",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MacMediaEngineCore", targets: ["MacMediaEngineCore"]),
        .library(name: "MacMediaEnginePlatform", targets: ["MacMediaEnginePlatform"]),
        .library(name: "MacMediaEngineChartRenderer", targets: ["MacMediaEngineChartRenderer"]),
        .executable(name: "mac-media-engine", targets: ["MacMediaEngine"]),
        .executable(name: "mac-media-engine-contract-tests", targets: ["MacMediaEngineContractTests"]),
        .executable(name: "native-input-telemetry-contract-tests", targets: ["NativeInputTelemetryContractTests"]),
        .executable(name: "native-input-platform-contract-tests", targets: ["NativeInputPlatformContractTests"]),
        .executable(name: "native-chart-renderer-contract-tests", targets: ["NativeChartRendererContractTests"]),
    ],
    targets: [
        .target(name: "MacMediaEngineCore"),
        .target(name: "MacMediaEnginePlatform", dependencies: ["MacMediaEngineCore"]),
        .target(name: "MacMediaEngineChartRenderer"),
        .executableTarget(name: "MacMediaEngine", dependencies: ["MacMediaEngineCore", "MacMediaEnginePlatform"]),
        .executableTarget(
            name: "MacMediaEngineContractTests",
            dependencies: ["MacMediaEngineCore"],
            path: "Tests/MacMediaEngineCoreTests"
        ),
        .executableTarget(
            name: "NativeInputTelemetryContractTests",
            dependencies: ["MacMediaEngineCore"],
            path: "Tests/NativeInputTelemetryContractTests"
        ),
        .executableTarget(
            name: "NativeInputPlatformContractTests",
            dependencies: ["MacMediaEngineCore", "MacMediaEnginePlatform"],
            path: "Tests/NativeInputPlatformContractTests"
        ),
        .executableTarget(
            name: "NativeChartRendererContractTests",
            dependencies: ["MacMediaEngineChartRenderer"],
            path: "Tests/NativeChartRendererContractTests"
        ),
    ]
)
