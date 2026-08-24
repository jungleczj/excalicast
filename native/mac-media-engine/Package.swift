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
        .library(name: "MacMediaEngineFinalCompositorStage1", targets: ["MacMediaEngineFinalCompositorStage1"]),
        .library(name: "MacMediaEngineFinalCompositorStage2", targets: ["MacMediaEngineFinalCompositorStage2"]),
        .library(name: "MacMediaEngineFinalRenderJobController", targets: ["MacMediaEngineFinalRenderJobController"]),
        .executable(name: "mac-media-engine", targets: ["MacMediaEngine"]),
        .executable(name: "mac-media-engine-contract-tests", targets: ["MacMediaEngineContractTests"]),
        .executable(name: "native-input-telemetry-contract-tests", targets: ["NativeInputTelemetryContractTests"]),
        .executable(name: "native-input-platform-contract-tests", targets: ["NativeInputPlatformContractTests"]),
        .executable(name: "native-chart-renderer-contract-tests", targets: ["NativeChartRendererContractTests"]),
        .executable(name: "native-streaming-teaching-audio-contract-tests", targets: ["NativeStreamingTeachingAudioContractTests"]),
        .executable(name: "native-final-compositor-stage1-contract-tests", targets: ["NativeFinalCompositorStage1ContractTests"]),
        .executable(name: "native-final-compositor-stage2-contract-tests", targets: ["NativeFinalCompositorStage2ContractTests"]),
        .executable(name: "native-final-render-job-controller-contract-tests", targets: ["NativeFinalRenderJobControllerContractTests"]),
    ],
    targets: [
        .target(name: "MacMediaEngineCore"),
        .target(name: "MacMediaEnginePlatform", dependencies: ["MacMediaEngineCore"]),
        .target(name: "MacMediaEngineChartRenderer"),
        .target(
            name: "MacMediaEngineTeachingAudio",
            linkerSettings: [.linkedFramework("AVFoundation"), .linkedFramework("AudioToolbox")]
        ),
        .target(name: "MacMediaEngineFinalCompositorStage1"),
        .target(name: "MacMediaEngineFinalCompositorStage2"),
        .target(name: "MacMediaEngineFinalRenderJobController"),
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
        .executableTarget(
            name: "NativeFinalCompositorStage1ContractTests",
            dependencies: ["MacMediaEngineFinalCompositorStage1"],
            path: "Tests/NativeFinalCompositorStage1ContractTests"
        ),
        .executableTarget(
            name: "NativeFinalCompositorStage2ContractTests",
            dependencies: ["MacMediaEngineFinalCompositorStage2"],
            path: "Tests/NativeFinalCompositorStage2ContractTests"
        ),
        .executableTarget(
            name: "NativeFinalRenderJobControllerContractTests",
            dependencies: ["MacMediaEngineFinalRenderJobController"],
            path: "Tests/NativeFinalRenderJobControllerContractTests"
        ),
    ]
)
