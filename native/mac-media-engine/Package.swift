// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MacMediaEngine",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MacMediaEngineCore", targets: ["MacMediaEngineCore"]),
        .library(name: "MacMediaEnginePlatform", targets: ["MacMediaEnginePlatform"]),
        .library(name: "MacMediaEngineChartRenderer", targets: ["MacMediaEngineChartRenderer"]),
        .library(name: "MacMediaEngineTeachingAudio", targets: ["MacMediaEngineTeachingAudio"]),
        .executable(name: "mac-media-engine", targets: ["MacMediaEngine"]),
        .executable(name: "mac-media-engine-contract-tests", targets: ["MacMediaEngineContractTests"]),
        .executable(name: "native-input-telemetry-contract-tests", targets: ["NativeInputTelemetryContractTests"]),
        .executable(name: "native-input-platform-contract-tests", targets: ["NativeInputPlatformContractTests"]),
        .executable(name: "native-chart-renderer-contract-tests", targets: ["NativeChartRendererContractTests"]),
        .executable(name: "native-streaming-teaching-audio-contract-tests", targets: ["NativeStreamingTeachingAudioContractTests"]),
    ],
    targets: [
        .target(name: "MacMediaEngineCore"),
        .target(name: "MacMediaEnginePlatform", dependencies: ["MacMediaEngineCore"]),
        .target(name: "MacMediaEngineChartRenderer"),
        .target(
            name: "MacMediaEngineTeachingAudio",
            linkerSettings: [.linkedFramework("AVFoundation"), .linkedFramework("AudioToolbox")]
        ),
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
        .executableTarget(
            name: "NativeStreamingTeachingAudioContractTests",
            dependencies: ["MacMediaEngineTeachingAudio"],
            path: "Tests/NativeStreamingTeachingAudioContractTests"
        ),
    ]
)
