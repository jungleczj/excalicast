# claude.md — 白板 录制增强工具

本文件是 AI 编程助手的项目上下文文件。每次对话开始前请先读取本文件。

---

## 项目概述

本项目是一个基于 白板 的录制增强工具，核心功能：
1. **录制**：在 白板 内同步采集操作事件流 + 麦克风音频
2. **画幅比例**：录制前选择输出比例（16:9 / 9:16 / 1:1 / 4:3），画板显示裁切框
3. **人像窗口**：摄像头人脸气泡叠加在画板视频上，可拖拽定位
4. **导出**：支持 MP4 视频、.excr 操作序列包、静态图
5. **字幕**：基于 Whisper 将音频转为 SRT 字幕
6. **讲义**：结合画板语义 + 字幕，AI 生成结构化 Markdown 文档

**产品形态**：Web 应用（包裹 白板），优先 PC Chrome 110+

---

## 技术栈

```
前端：React 18 + TypeScript + Vite
画板：@whiteboard-core/whiteboard-core（锁定版本，见 package.json）
音频：MediaRecorder API + WebAudio API
摄像头：MediaDevices API + MediaRecorder（独立录制流）
人像背景分割：@mediapipe/selfie_segmentation（可选，GPU 加速）
视频合成：ffmpeg.wasm（浏览器端，无需上传）
本地存储：IndexedDB（Dexie.js）
字幕：OpenAI Whisper API（whisper-1）
讲义 AI：deepseek（deepseek-v4-flash）
样式：Tailwind CSS
```

---

## 目录结构

```
src/
├── app/                    # 应用入口和路由
│   └── App.tsx
├── components/
│   ├── RecordingBar/       # 录制控制栏组件
│   │   ├── index.tsx
│   │   └── RecordingBar.test.tsx
│   ├── RecordingSetup/     # 录制前设置面板（比例 + 人像开关）
│   ├── AspectCropOverlay/  # 裁切框预览层
│   ├── CameraWindow/       # 人像浮窗组件（可拖拽）
│   ├── SubtitleOverlay/    # 字幕叠加层
│   ├── PlaybackViewer/     # 操作序列回放播放器
│   └── HandoutViewer/      # 讲义预览
├── hooks/
│   ├── useRecording.ts     # 录制状态机（核心）
│   ├── useAudio.ts         # 麦克风采集
│   ├── useCamera.ts        # 摄像头采集 + 人像分割
│   ├── useCropRegion.ts    # 裁切框逻辑（坐标映射）
│   └── useExport.ts        # 导出逻辑
├── services/
│   ├── eventCapture.ts     # Hook 白板 onChange
│   ├── whisper.ts          # Whisper API 调用
│   ├── handout.ts          # 讲义生成（Deepseek API）
│   ├── ffmpegExport.ts     # ffmpeg.wasm 视频合成（含人像叠加）
│   ├── storage.ts          # IndexedDB 存储（Dexie）
│   ├── cloudStorage.ts     # 云端上传（OSS/S3，仅登录用户）
│   └── shareLink.ts        # 分享链接生成（Max）
├── hooks/
│   ├── useAuth.ts          # 登录状态管理
│   └── useStorageStrategy.ts  # 根据登录状态决定存哪里
├── types/
│   └── recording.ts        # 核心类型定义
└── utils/
    ├── timeFormat.ts
    ├── srtParser.ts
    └── aspectRatio.ts      # 比例计算工具函数
```

---

## 核心类型定义

```typescript
// src/types/recording.ts

export type SubscriptionTier = 'free' | 'one_time' | 'pro' | 'max';

// 登录与存储策略
// 注意：one_time 不需要登录，free 也不需要登录
export type AuthState = 'anonymous' | 'logged_in';

export interface StorageStrategy {
  local: boolean;           // 存 IndexedDB（始终为 true）
  cloud: boolean;           // 是否同步到云端（Pro/Max 登录后）
  whisperUpload: boolean;   // 是否允许上传音频给 Whisper（Pro/Max）
  shareUpload: boolean;     // 是否允许上传事件流到 OSS 生成分享链接（Max）
}

// 登录状态 + 会员层级 → 存储策略
// one_time 不登录，数据全程本地，服务端只验证支付令牌
export function getStorageStrategy(auth: AuthState, tier: SubscriptionTier): StorageStrategy {
  return {
    local: true,
    cloud: auth === 'logged_in' && (tier === 'pro' || tier === 'max'),
    whisperUpload: auth === 'logged_in' && (tier === 'pro' || tier === 'max'),
    shareUpload: auth === 'logged_in' && tier === 'max',
  };
}

// 游客 ID（未登录用户持久化，用于后续账户迁移）
export interface GuestSession {
  guestId: string;
  recordingIds: string[];
}

// 单次购买令牌（匿名支付后由服务端签发，仅用于解锁本地无水印渲染）
export interface OneTimeRenderToken {
  jwt: string;          // 签名 JWT，存 sessionStorage（关闭浏览器自动清除）
  expiresAt: number;    // Unix timestamp，2小时有效
  consumed: boolean;    // 使用后标记，防止重复渲染
}

// 功能门控
export const TIER_PERMISSIONS: Record<SubscriptionTier, {
  exportWithoutWatermark: boolean;
  requiresLogin: boolean;       // 新增：是否需要登录
  uploadsData: boolean;         // 新增：是否会上传录制数据到服务端
  subtitle: boolean;
  handout: boolean;
  shareLink: boolean;
  unlimitedDuration: boolean;
  cloudBackup: boolean;
}> = {
  free:     { requiresLogin: false, uploadsData: false, exportWithoutWatermark: false, subtitle: false, handout: false, shareLink: false, unlimitedDuration: false, cloudBackup: false },
  one_time: { requiresLogin: false, uploadsData: false, exportWithoutWatermark: true,  subtitle: false, handout: false, shareLink: false, unlimitedDuration: false, cloudBackup: false },
  pro:      { requiresLogin: true,  uploadsData: true,  exportWithoutWatermark: true,  subtitle: true,  handout: false, shareLink: false, unlimitedDuration: true,  cloudBackup: true  },
  max:      { requiresLogin: true,  uploadsData: true,  exportWithoutWatermark: true,  subtitle: true,  handout: true,  shareLink: true,  unlimitedDuration: true,  cloudBackup: true  },
};

export const FREE_DURATION_LIMIT_MS = 30 * 60 * 1000;

export type AspectRatio =
  // 横屏
  | '16:9' | '4:3' | '21:9' | '16:10' | '3:2'
  // 竖屏
  | '9:16' | '4:5' | '3:4' | '2:3'
  // 方形
  | '1:1'
  // 自定义
  | 'custom';

export interface AspectRatioConfig {
  ratio: AspectRatio;
  width: number;            // 导出视频像素宽
  height: number;           // 导出视频像素高
  cropRegion?: CropRegion;  // 裁切框在 白板 scene 坐标系中的位置
}

export interface CropRegion {
  x: number;                // scene 坐标
  y: number;
  width: number;
  height: number;
}

export type CameraWindowShape = 'circle' | 'rounded';
export type CameraWindowPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface CameraWindowConfig {
  enabled: boolean;
  sizePx: number;                 // 80～480，由滑动条控制，替代原 small/medium/large 枚举
  shape: CameraWindowShape;
  position: CameraWindowPosition;
  backgroundRemoval: boolean;
}

export interface CameraWindowEvent {
  timestamp: number;
  x: number;
  y: number;
  sizePx: number;                 // 记录当时的尺寸（录制中可调整）
  hidden: boolean;
}

export interface 白板Event {
  timestamp: number;              // ms，相对录制开始
  type: 'add' | 'update' | 'delete' | 'select';
  elements_delta: 白板Element[];
  appState_delta?: Partial<AppState>;
}

export interface RecordingSession {
  id: string;                     // uuid
  startedAt: number;              // Unix timestamp
  duration: number;               // ms
  aspectRatioConfig: AspectRatioConfig;
  cameraWindowConfig: CameraWindowConfig;
  events: 白板Event[];
  cameraEvents: CameraWindowEvent[];  // 人像窗口位置变化记录
  audioBlob?: Blob;               // 麦克风，Opus/WebM
  cameraBlob?: Blob;              // 摄像头，VP8/WebM
  initialElements: 白板Element[];
}

export interface SubtitleSegment {
  index: number;
  startTime: number;              // ms
  endTime: number;
  text: string;
}

export interface HandoutSection {
  title: string;
  startTime: number;
  endTime: number;
  summary: string;
  keyframeSnapshot: string;       // base64 PNG
  transcript: string;
}

export interface HandoutDocument {
  title: string;
  createdAt: number;
  sections: HandoutSection[];
  fullTranscript: string;
}

export type RecordingState =
  | 'idle'
  | 'setup'                       // 新增：用户配置比例和人像
  | 'requesting_permission'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'done'
  | 'error';

export type ExportFormat = 'mp4' | 'excr' | 'png' | 'svg';
```

---

## 关键模块实现指南

### 0. 画幅比例与裁切框（useCropRegion.ts + aspectRatio.ts）

**比例到像素的映射**：

```typescript
// utils/aspectRatio.ts
export const ASPECT_RATIO_PRESETS: Record<
  Exclude<AspectRatio, 'custom'>,
  { width: number; height: number; label: string; group: 'landscape' | 'portrait' | 'square'; platforms: string }
> = {
  // 横屏
  '16:9':  { width: 1920, height: 1080, label: '16:9',  group: 'landscape', platforms: 'YouTube · B站 · 视频号横屏 · Zoom' },
  '4:3':   { width: 1440, height: 1080, label: '4:3',   group: 'landscape', platforms: '传统培训平台 · PPT · 钉钉直播' },
  '21:9':  { width: 2560, height: 1080, label: '21:9',  group: 'landscape', platforms: '超宽屏显示器 · 电影感演示' },
  '16:10': { width: 1920, height: 1200, label: '16:10', group: 'landscape', platforms: 'MacBook · iPad Air/Pro横屏' },
  '3:2':   { width: 1620, height: 1080, label: '3:2',   group: 'landscape', platforms: 'Surface · 佳能EOS R · Sony A7 · 尼康Z · 富士X' },
  // 竖屏（分辨率统一以1080为宽基准）
  '9:16':  { width: 1080, height: 1920, label: '9:16',  group: 'portrait',  platforms: '抖音 · TikTok · 视频号 · 快手 · Shorts · Reels · B站竖屏' },
  '4:5':   { width: 1080, height: 1350, label: '4:5',   group: 'portrait',  platforms: 'Instagram Feed竖图 · Facebook竖版' },
  '3:4':   { width: 1080, height: 1440, label: '3:4',   group: 'portrait',  platforms: '小红书图文笔记 · 微博竖版 · iPad竖屏' },
  '2:3':   { width: 1080, height: 1620, label: '2:3',   group: 'portrait',  platforms: '小红书封面图 · Pinterest · 海报印刷' },
  // 方形
  '1:1':   { width: 1080, height: 1080, label: '1:1',   group: 'square',    platforms: 'Instagram方图 · 微博 · 小红书封面 · 朋友圈' },
};

// 白板 scene 坐标 → 视频像素坐标
export function sceneToVideoCoords(
  sceneX: number, sceneY: number,
  cropRegion: CropRegion,
  videoSize: { width: number; height: number }
): { x: number; y: number } {
  const scaleX = videoSize.width / cropRegion.width;
  const scaleY = videoSize.height / cropRegion.height;
  return {
    x: (sceneX - cropRegion.x) * scaleX,
    y: (sceneY - cropRegion.y) * scaleY,
  };
}
```

**裁切框预览层**（`AspectCropOverlay` 组件）：
- 绝对定位覆盖在 白板 画板之上，pointer-events: none（不拦截画板交互）
- 裁切框内部透明，框外半透明蒙层（rgba(0,0,0,0.4)）
- 裁切框四角显示拖拽手柄，整体可拖拽移动（pointer-events: all 仅在手柄上）
- 9:16 竖屏时：裁切框高度超过视口，需要滚动提示

**注意**：裁切框坐标存储在 **白板 scene 坐标系**中，不是屏幕像素坐标，以保证缩放画板时裁切区域不漂移。换算公式：`sceneCoord = screenCoord / zoom + scrollOffset`。

---

### 0.5 人像窗口（useCamera.ts + CameraWindow 组件）

**摄像头采集**：

```typescript
// hooks/useCamera.ts
export function useCamera(config: CameraWindowConfig) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const start = async () => {
    if (!config.enabled) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 640, facingMode: 'user' },
      audio: false, // 音频单独采集
    });

    // 实时预览
    if (videoRef.current) videoRef.current.srcObject = stream;

    // 独立录制（与音频录制完全分离）
    recorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorderRef.current.ondataavailable = async (e) => {
      await db.cameraChunks.add({ sessionId, chunk: e.data });
    };
    recorderRef.current.start(1000);

    // 背景分割（可选）
    if (config.backgroundRemoval) {
      await startBackgroundRemoval(stream, videoRef.current!);
    }
  };

  return { videoRef, start, stop, pause };
}
```

**CameraWindow 组件关键点**：

```typescript
// 尺寸由滑动条实时控制（80～480px）
// 注意：sizePx 改变时要同步更新 CSS 和 cameraEvents
const [sizePx, setSizePx] = useState(config.sizePx); // 默认 200

const handleSizeChange = (newSize: number) => {
  setSizePx(newSize);
  // 录制中：立即记录 cameraEvent（尺寸变更）
  if (isRecording) {
    recordCameraEvent({ timestamp: now(), x: currentX, y: currentY, sizePx: newSize, hidden: isHidden });
  }
};

// 形状通过 CSS 实现
const shapeStyle = config.shape === 'circle'
  ? { borderRadius: '50%' }
  : { borderRadius: '16px' };

// 滑动条组件（Tailwind + input[type=range]）
<input
  type="range" min={80} max={480} step={1}
  value={sizePx}
  onChange={(e) => handleSizeChange(Number(e.target.value))}
  className="w-full accent-blue-500"
/>

// 拖拽：dragEnd 记录位置
const handleDragEnd = (x: number, y: number) => {
  recordCameraEvent({ timestamp: now(), x, y, sizePx, hidden: isHidden });
};

// 双击隐藏
const handleDoubleClick = () => {
  setIsHidden(h => !h);
  recordCameraEvent({ timestamp: now(), x: currentX, y: currentY, sizePx, hidden: !isHidden });
};
```

---

### 0.6 录制隔离原理（OffscreenCanvas）

**这是本产品相比传统录屏的核心架构优势，不需要额外开发，需要理解原理避免破坏它。**

```typescript
// 录制渲染管线完全在离屏 Canvas 中进行
// 与用户可见的 DOM 完全解耦

// 导出时（帧渲染）：
const offscreen = new OffscreenCanvas(videoWidth, videoHeight);
// 按事件流重放，逐帧绘制到 offscreen，转为 PNG 序列
// 整个过程：其他窗口、遮挡、最小化对此 Canvas 无任何影响

// 实时录制时（音频 + 事件流）：
// 音频：MediaRecorder 采集麦克风，与屏幕无关
// 事件：白板 onChange 回调，与屏幕渲染无关
// → 即使浏览器最小化，onChange 仍然触发（用户在画板上的操作仍然有效）
```

**切换标签页时的处理**：
- 用户切换走：白板 画板无法操作，但音频继续采集 ✅
- 录制不中断，但建议 UI 层显示悬浮 pip 窗口提醒用户
- `visibilitychange` 事件：仅记录日志，不暂停录制（与之前的"切换标签页自动暂停"策略相反，需要去掉该限制）

**注意**：不要在 `visibilitychange` 时暂停录制，这会破坏录制隔离的完整性。让用户手动决定是否暂停。

**背景分割（可选）**：

```typescript
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';

async function startBackgroundRemoval(stream: MediaStream, videoEl: HTMLVideoElement) {
  const seg = new SelfieSegmentation({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}` });
  seg.setOptions({ modelSelection: 1 });

  // 每帧处理，输出到 OffscreenCanvas，替换 videoEl 的显示
  // 仅做预览用，录制流仍为原始摄像头（合成时在 ffmpeg 层处理透明）
  // 注意：此方案对 GPU 有要求，低配设备跳过
}
```

**ffmpeg 合成人像窗口**：

```typescript
// 在 ffmpegExport.ts 中，叠加人像视频
// 按 cameraEvents 中记录的位置，每段时间生成对应的 overlay 命令

// 静态位置（右下角）示意：
await ffmpeg.exec([
  '-i', 'board.mp4',           // 画板视频
  '-i', 'camera.webm',         // 摄像头视频
  '-filter_complex',
  `[1:v]scale=${cameraSize}:${cameraSize}[cam];
   [0:v][cam]overlay=W-w-20:H-h-20`,  // 右下角，间距20px
  '-c:a', 'copy',
  'output_with_cam.mp4'
]);

// 动态位置（跟随 cameraEvents）：
// 使用 enable 和 x/y 表达式，或分段 concat
```

**权限独立降级**：
- 麦克风拒绝：仅无声音，人像/录制正常
- 摄像头拒绝：仅无人像，音频/录制正常
- 两者都拒绝：仅录操作序列
- **三者完全独立，不互相阻断**

---

### 1. 事件采集（eventCapture.ts）

Hook 白板 的 `onChange` 回调：

```typescript
// 在 <白板> 组件上挂载 onChange
<白板
  onChange={(elements, appState) => {
    if (recordingState === 'recording') {
      captureEvent(elements, appState);
    }
  }}
/>
```

**注意**：
- `onChange` 触发频率高，需要 debounce（建议 50ms）+ 只记录 delta（对比上一帧）
- 元素快照使用 `structuredClone` 深拷贝，不能存引用
- 事件流写入 IndexedDB，不要全量存内存（防止长录制 OOM）

---

### 1.5 录制隔离：为什么不受窗口遮挡影响（核心原理）

**本产品的帧采集方式是直接读取 白板 的 Canvas DOM，而不是捕获屏幕像素。** 这是整个录制系统最重要的架构约束。

```typescript
// ✅ 正确：直接从 Canvas 元素读帧，完全隔离于屏幕显示
async function captureFrame(whiteboard-coreCanvas: HTMLCanvasElement): Promise<ImageData> {
  // 直接从 DOM Canvas 拿像素，不经过屏幕合成器
  // 无论浏览器是否被遮挡、最小化、在后台，都能拿到完整帧
  const offscreen = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(whiteboard-coreCanvas, ...cropTransform);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

// ❌ 严禁：屏幕捕获方式，遮挡时录到遮挡物，最小化时录到黑屏
const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true }); // 绝对不用
```

**实际效果**：
- 用户切换到微信回消息 → 录制帧完全不受影响，仍是 白板 内容
- 其他窗口压在浏览器上 → 录制帧不受影响
- 浏览器最小化 → 音频继续录，帧采集因浏览器限制暂停（但这是"没有新操作"而非"录到黑屏"）

**获取 白板 Canvas 元素的方式**：

```typescript
// 白板 会在容器内渲染一个 <canvas> 元素
// 通过 ref 获取容器，再 querySelector 找到 canvas
const containerRef = useRef<HTMLDivElement>(null);

const get白板Canvas = (): HTMLCanvasElement | null => {
  return containerRef.current?.querySelector('canvas') ?? null;
};

// 导出时按事件流重放，逐帧调用 captureFrame
// 重放时不需要真实渲染到屏幕，用 OffscreenCanvas + headless 渲染即可
```

---

### 2. 录制状态机（useRecording.ts）

状态转换规则：

```
idle → setup（用户配置比例+人像）→ requesting_permission → recording → paused → recording → processing → done
                                                                       ↘ processing → done
任意状态 → error
```

**关键逻辑**：
- `openSetup()`：进入 setup 状态，展示设置面板
- `start()`：setup 确认后，并发请求麦克风 + 摄像头权限（独立 try-catch），成功后同步启动所有 MediaRecorder 和事件采集
- `pause()`：暂停所有 MediaRecorder（音频 + 摄像头）+ 暂停事件采集，计时器停止
- `stop()`：停止所有采集，合并 chunks，写入 IndexedDB
- 页面 `visibilitychange` 为 hidden 时：**音频 MediaRecorder 继续**（不暂停），仅停止帧采集定时器。这样用户切换应用时，语音不中断，画板操作事件通过 onChange 自然续接

---

### 3. 音频采集（useAudio.ts）

**码率选择原则**：语音场景 32kbps Opus 与 128kbps MP3 听感无差异，30分钟从 ~100MB 降至 ~7MB。

```typescript
const constraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: 16000,        // 语音场景 16kHz 足够（Whisper 也是 16kHz）
    channelCount: 1,           // 单声道，语音无需立体声
  }
};
const stream = await navigator.mediaDevices.getUserMedia(constraints);
const recorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 32000,  // 32kbps：语音透明质量，30分钟约 7MB
});

// chunks 写入 IndexedDB，而非内存数组
recorder.ondataavailable = async (e) => {
  await db.audioChunks.add({ sessionId, chunk: e.data, timestamp: Date.now() });
};
recorder.start(1000); // 每 1 秒一个 chunk
```

**VAD 静音检测（可选优化，可减少 40-60% 存储）**：

```typescript
// 用 AnalyserNode 实时检测音量
const audioCtx = new AudioContext();
const source = audioCtx.createMediaStreamSource(stream);
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 512;
source.connect(analyser);

const SILENCE_THRESHOLD = 10; // 0-255，低于此值视为静音
const dataArray = new Uint8Array(analyser.frequencyBinCount);

function isSilent(): boolean {
  analyser.getByteFrequencyData(dataArray);
  const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
  return avg < SILENCE_THRESHOLD;
}

// 录制中每秒判断：静音段只存时间戳标记，不存音频数据
// 回放时静音段用空白填充，保证时间轴对齐
```

**存储成本对比（30分钟，月均10次）**：

| 方案 | 单次大小 | 月均总量 | S3成本/月 |
|------|---------|---------|----------|
| 未优化（原PRD） | ~100MB | ~1GB | ~$0.023 |
| Opus 32kbps | ~7MB | ~70MB | ~$0.0016 |
| Opus 32kbps + VAD | ~3-4MB | ~35MB | ~$0.0008 |

**Whisper API 的文件大小限制为 25MB**，使用 Opus 32kbps 后单次录制文件远低于此限制，无需分片处理（除非超过 60 分钟）。

---

### 4. Whisper 字幕（whisper.ts）

```typescript
export async function generateSubtitles(audioBlob: Blob): Promise<SubtitleSegment[]> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'srt');
  formData.append('language', 'zh'); // 可自动检测，建议用户选择

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  const srtText = await response.text();
  return parseSRT(srtText);
}
```

**注意**：
- Whisper API 文件大小限制 25MB，超出需分片（按静音点切割）
- 错误处理：网络超时（设置 120s timeout）、API 限速（exponential backoff）

---

### 5. 讲义生成（handout.ts）

**提示词设计原则**：让模型同时拿到画板语义和文字稿。

```typescript
export async function generateHandout(
  session: RecordingSession,
  subtitles: SubtitleSegment[]
): Promise<HandoutDocument> {

  // 从事件流提取画板语义摘要
  const boardSummary = extractBoardSemantic(session.events);
  // 示例输出：[{t: 32000, action: "新增节点'数据库'", elements: [...]}]

  const fullTranscript = subtitles.map(s => `[${formatTime(s.startTime)}] ${s.text}`).join('\n');

  const prompt = `
你是一个专业的技术文档生成助手。
以下是一段 白板 白板录制的内容：

## 画板操作记录（带时间戳）
${JSON.stringify(boardSummary, null, 2)}

## 语音文稿（带时间戳）
${fullTranscript}

请生成结构化讲义，要求：
1. 识别 3-7 个章节（基于话题切换和操作密度）
2. 每章节包含：标题、起止时间、200字以内摘要
3. 输出 JSON 格式，schema 如下：
{
  "title": "讲义标题",
  "sections": [
    {
      "title": "章节标题",
      "startTime": 0,
      "endTime": 120000,
      "summary": "...",
      "keyTimestamp": 60000
    }
  ]
}
只返回 JSON，不要其他文字。
  `;

  const response = await fetch('https://api.deepseek.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': DEEPSEEK_API_KEY,
      'Deepseek-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const raw = data.content[0].text;
  return parseHandoutJSON(raw, session, subtitles);
}
```

---

### 6. MP4 导出（ffmpegExport.ts）

```typescript
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export async function exportMP4(
  session: RecordingSession,
  onProgress: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();

  const { width, height } = session.aspectRatioConfig; // 如 1920×1080

  // 1. 逐帧渲染画板到 Canvas（按裁切框 + 比例），生成 PNG 序列
  const frames = await renderFrames(session, { width, height }, onProgress);

  // 2. 写入音频
  if (session.audioBlob) {
    await ffmpeg.writeFile('audio.webm', await fetchFile(session.audioBlob));
  }

  // 3. 合成画板视频
  await ffmpeg.exec([
    '-framerate', '30',
    '-i', 'frame_%04d.png',
    ...(session.audioBlob ? ['-i', 'audio.webm'] : []),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac',
    '-s', `${width}x${height}`,
    'board.mp4'
  ]);

  // 4. 叠加人像窗口（如有）
  if (session.cameraBlob && session.cameraWindowConfig.enabled) {
    await ffmpeg.writeFile('camera.webm', await fetchFile(session.cameraBlob));
    const camPx = CAM_SIZE_PX[session.cameraWindowConfig.size]; // 160/240/320
    const overlayFilter = buildOverlayFilter(session.cameraEvents, camPx, width, height);

    await ffmpeg.exec([
      '-i', 'board.mp4',
      '-i', 'camera.webm',
      '-filter_complex', overlayFilter,
      '-c:a', 'copy',
      'with_cam.mp4'
    ]);
  }

  // 5. 嵌入字幕（如有 SRT）
  // ffmpeg -i with_cam.mp4 -i subtitles.srt -c copy -c:s mov_text output.mp4

  const finalFile = session.cameraBlob ? 'with_cam.mp4' : 'board.mp4';
  const data = await ffmpeg.readFile(finalFile);
  return new Blob([data], { type: 'video/mp4' });
}

// 动态尺寸 + 动态位置（根据 cameraEvents 分段处理）
function buildOverlayFilter(
  events: CameraWindowEvent[],
  videoW: number,
  videoH: number
): string {
  if (events.length === 0) {
    // 默认：200px 右下角
    return `[1:v]scale=200:200[cam];[0:v][cam]overlay=${videoW - 220}:${videoH - 220}`;
  }

  // 按事件分段：每段时间区间有独立的 sizePx + x/y
  // 简化实现：仅处理尺寸和位置的关键帧，线性插值留到后期优化
  // MVP：取最后一个事件的状态作为全程默认（简化合成）
  const last = events[events.length - 1];
  const s = last.sizePx;
  return `[1:v]scale=${s}:${s}[cam];[0:v][cam]overlay=${last.x}:${last.y}`;

  // 生产实现：用 enable 表达式按时间段切换
  // [1:v]scale=s1:s1[cam1];[0:v][cam1]overlay=x1:y1:enable='between(t,0,10)'[v1];
  // [1:v]scale=s2:s2[cam2];[v1][cam2]overlay=x2:y2:enable='between(t,10,30)'[v2]...
}
```

**性能注意**：
- 帧渲染是瓶颈，使用 OffscreenCanvas + Web Worker
- 摄像头视频叠加在 ffmpeg 层处理，不在帧渲染阶段处理（减少复杂度）
- 10 分钟录制预计需要 3-6 分钟本地渲染（含人像合成）
- 必须显示分阶段进度（帧渲染 → 视频编码 → 人像叠加 → 完成）

---

## 环境变量

```bash
# .env.local
VITE_OPENAI_API_KEY=sk-...       # Whisper 字幕
VITE_ANTHROPIC_API_KEY=sk-ant-... # 讲义生成

# 注意：生产环境 API Key 不能暴露在前端
# 应通过 BFF（Next.js API Route 或 Cloudflare Worker）代理
```

---

## 常见开发问题

### Q: 白板 onChange 触发太频繁怎么办？
用 50ms debounce，并只记录与上一个事件的 diff（比较 element id + version 字段）。

### Q: 滑动条调整摄像头尺寸时，录制中的摄像头流本身尺寸需要变吗？
不需要。摄像头流始终以 640×640 录制（高质量源），`sizePx` 只影响：(1) 预览时的 CSS 尺寸，(2) ffmpeg 导出时的 `scale` 参数。录制中修改 sizePx 只更新 cameraEvents，不重启摄像头流。

### Q: 用户登录状态如何影响数据存储？

**核心原则：登录前可完整体验核心价值，数据永远先存本地。**

```
用户行为                    登录要求    数据位置
─────────────────────────────────────────────────
录制 / 本地回放              不需要     IndexedDB
导出含水印 MP4               不需要     本地渲染下载
─────────────────────────────────────────────────
导出无水印（单次购买）        需要登录   触发注册 + 支付
生成字幕（Pro）               需要登录   音频临时上传 Whisper
AI 讲义（Max）                需要登录   事件流 + 音频上传
生成分享链接（Max）           需要登录   事件流 + 音频上传 OSS
─────────────────────────────────────────────────
云端备份（防丢失）            需要登录   Pro/Max 自动同步
```

**未登录用户的游客 ID 机制**（防止数据孤岛）：

```typescript
// hooks/useAuth.ts
export function getOrCreateGuestId(): string {
  let guestId = localStorage.getItem('guestId');
  if (!guestId) {
    guestId = crypto.randomUUID();
    localStorage.setItem('guestId', guestId);
  }
  return guestId;
}

// 用户注册/登录后，提示迁移本地数据
export async function migrateGuestData(guestId: string, userToken: string) {
  const localRecordings = await db.sessions
    .where('guestId').equals(guestId)
    .toArray();

  if (localRecordings.length === 0) return;

  // 提示用户：发现 N 条本地录制，是否上传到账户？
  const confirmed = await showMigrationPrompt(localRecordings.length);
  if (!confirmed) return;

  for (const session of localRecordings) {
    await uploadSessionToCloud(session, userToken);
  }
}
```

**触发登录的最佳时机**：用户已经录完、确认产品有价值之后——即点击"去除水印"、"生成字幕"、"生成讲义"、"分享"这四个操作节点。不要在进入页面时要求登录。

### Q: 分享链接存什么？

**只存操作事件流 + 音频，永远不上传 MP4 视频。** 理由：

- 操作事件流可以无损重建任意时刻的画板状态，等价于视频但小 10-20 倍
- MP4 存储成本是事件流 + 音频的 10-20 倍，且对 AI 讲义生成无额外价值
- 收件方通过 Web 播放器看回放，体验与视频一致

```typescript
// services/shareLink.ts
export async function createShareLink(session: RecordingSession): Promise<string> {
  // 只上传事件流 + 音频，不上传视频
  const payload = {
    events: session.events,           // JSON，<20MB
    audioBlob: session.audioBlob,     // Opus/WebM，<100MB
    metadata: {
      duration: session.duration,
      aspectRatio: session.aspectRatioConfig.ratio,
      createdAt: Date.now(),
      schemaVersion: '1.0',
    }
  };

  // 上传到 OSS/S3
  const { key } = await uploadToStorage(payload);

  // 服务端生成短链（UUID，不可枚举）
  const response = await fetch('/api/share', {
    method: 'POST',
    body: JSON.stringify({ storageKey: key, ttlDays: 30 }),
    headers: { Authorization: `Bearer ${userToken}` }
  });

  const { shortUrl } = await response.json();
  return shortUrl; // 如 https://[产品域名]/s/abc123xyz
}
```

**收件方访问分享链接时**：Web 播放器拉取事件流 + 音频 → 客户端重渲染白板 → 可选"导出 MP4"（在收件方本地用 ffmpeg.wasm 渲染，不消耗服务器）。

唯一限制：分享链接不能直接在微信/抖音内嵌播放（这些平台需要 MP4 URL）。收件方如需二次发布，点"导出 MP4"在本地渲染后自行上传。

### Q: 录制时长限制怎么实现？
时长限制是**商业逻辑而非技术限制**，技术上 IndexedDB + 音频流没有强制上限。实现方式：

```typescript
// 在 useRecording.ts 中
const checkDurationLimit = (elapsed: number, tier: SubscriptionTier) => {
  if (TIER_PERMISSIONS[tier].unlimitedDuration) return; // Pro / Max 不限制
  if (elapsed >= FREE_DURATION_LIMIT_MS - 5 * 60 * 1000) {
    showWarningBanner('剩余 5 分钟，升级 Pro 可无限录制');
  }
  if (elapsed >= FREE_DURATION_LIMIT_MS) {
    autoSaveAndPromptUpgrade(); // 保存完整数据，再弹引导
  }
};
```

**注意**：不要硬中断录制，应先自动保存完整数据，再弹引导。

### Q: 水印如何在 ffmpeg 中叠加？

```typescript
// ffmpegExport.ts - 免费导出时叠加水印
async function addWatermark(ffmpeg: FFmpeg, inputFile: string, outputFile: string) {
  // 水印图片需提前写入 ffmpeg 虚拟文件系统
  await ffmpeg.writeFile('watermark.png', await fetchFile('/assets/watermark.png'));

  await ffmpeg.exec([
    '-i', inputFile,
    '-i', 'watermark.png',
    '-filter_complex',
    // 右下角，距边缘 20px，透明度 60%
    '[1:v]format=rgba,colorchannelmixer=aa=0.6[wm];[0:v][wm]overlay=W-w-20:H-h-20',
    '-codec:a', 'copy',
    outputFile
  ]);
}

// 导出入口：根据 tier 决定是否叠加水印
export async function exportMP4(session: RecordingSession, tier: SubscriptionTier) {
  // ... 渲染画板帧、合成人像 ...
  if (!TIER_PERMISSIONS[tier].exportWithoutWatermark) {
    await addWatermark(ffmpeg, 'with_cam.mp4', 'output.mp4');
  }
}
```

水印规格：右下角距边缘 20px，透明度 60%，叠加在内容区（非纯黑边），不可通过简单裁切完全去除。

### Q: 单次购买 Token 如何验证（匿名，无需登录）？

```typescript
// 完整流程：服务端只验证支付，从不接触录制数据

// Step 1: 用户点击「去除水印」→ 发起 Stripe 一次性支付
// Stripe Checkout 无需账号，填邮箱 + 卡号即可
// 支付成功后 Stripe webhook 通知服务端

// Step 2: 服务端签发一次性 JWT
// POST /api/payment/webhook (Stripe)
// → 验证支付成功
// → 生成 JWT: { type:'one_time', jti: uuid(), exp: now+7200 }
// → 用私钥签名，存 jti 到 Redis（标记"未使用"）
// → 通过 Stripe success_url 的 query param 或 webhook 返回 JWT

// Step 3: 客户端拿到 JWT，存 sessionStorage
sessionStorage.setItem('renderToken', jwt);

// Step 4: 导出前验证并消耗令牌
async function consumeRenderToken(jwt: string): Promise<boolean> {
  const res = await fetch('/api/consume-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 只传令牌，不传任何录制数据
    body: JSON.stringify({ token: jwt }),
  });
  const { valid } = await res.json();
  if (valid) sessionStorage.removeItem('renderToken');
  return valid;
}

// Step 5: 本地 ffmpeg.wasm 渲染，令牌有效则跳过水印图层
const tokenValid = await consumeRenderToken(jwt);
await exportMP4(session, { watermark: !tokenValid });
// 录制数据（事件流 + 音频）全程在 IndexedDB，从未离开浏览器
```

**服务端令牌销毁逻辑**：

```typescript
// /api/consume-token
app.post('/api/consume-token', async (req, res) => {
  const { token } = req.body;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { jti } = payload as { jti: string };

    // 检查是否已使用（Redis）
    const used = await redis.get(`token:${jti}`);
    if (used) return res.json({ valid: false, reason: 'already_used' });

    // 标记为已使用，设置过期时间与 JWT 一致
    await redis.setex(`token:${jti}`, 7200, 'used');
    return res.json({ valid: true });
  } catch {
    return res.json({ valid: false, reason: 'invalid_token' });
  }
});
```

**关键安全要点**：
- JWT 存 `sessionStorage`，不存 `localStorage`，关闭浏览器自动清除
- `jti` 在 Redis 中一次性销毁，服务端拒绝重复使用
- 服务端全程不接收、不存储任何录制内容
- 令牌过期时间 2 小时，足够完成本地渲染

### Q: 为什么切换标签页不应该自动暂停录制？
因为录制隔离的核心价值就是"不受环境影响"。用户可能切换标签页去查资料，再回来继续讲，这段时间的音频仍然有效（比如用户在说话）。自动暂停破坏了这个特性。应该改为：切换标签页时显示悬浮提示，让用户自己决定是否暂停。

### Q: 裁切框坐标用屏幕像素还是 scene 坐标？
必须用 **scene 坐标**。用屏幕像素时，用户缩放画板后裁切区域会漂移。换算：`sceneX = (screenX - scrollX) / zoom`，从 `appState.scrollX / scrollY / zoom` 获取。

### Q: 21:9 超宽屏比例渲染时性能怎么处理？
2560×1080 比 1920×1080 帧面积大 33%，渲染耗时相应增加。导出前提示用户预估时间，可选降分辨率（如 1720×720）导出。

### Q: ffmpeg.wasm 在某些浏览器加载失败？
需要服务器设置 COOP/COEP header（SharedArrayBuffer 依赖）：
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Q: Whisper 返回的时间戳和操作序列如何对齐？
两者都以录制开始时间为基准（t=0），直接按 ms 对齐即可。音频分片时注意累加偏移量。

### Q: 讲义 AI 返回格式不稳定怎么处理？
用 `JSON.parse` 包 try-catch，失败时降级为纯文稿输出。可在 prompt 里加 few-shot 示例增强稳定性。

### Q: IndexedDB 存储上限问题？
Chrome 默认允许使用磁盘空间的 60%。录制完成后提示用户及时导出并清理。

---

## 不要做的事（禁止事项）

- ❌ **绝对不用 `getDisplayMedia()`** 采集画板内容——录屏幕像素，遮挡/最小化时内容错误
- ❌ 不要在时长到达限制时硬中断录制，必须先完整保存数据再弹引导
- ❌ 不要在单次购买令牌验证时传输任何录制数据，`/api/consume-token` 只接受令牌字符串
- ❌ 不要把令牌存 `localStorage`，必须存 `sessionStorage`（关闭浏览器自动清除）
- ❌ 不要在前端缓存"已验证"状态后跳过服务端验证，每次渲染必须调用服务端销毁令牌
- ❌ 不要在前端硬编码 API Key 后部署到生产，必须走服务端代理
- ❌ 不要把音频或操作事件全量存内存，必须用 IndexedDB 流式写入
- ❌ 不要修改白板内核源码，只用 onChange / initialData API
- ❌ 不要在录制过程中阻塞主线程（ffmpeg 渲染必须在 Worker 中）
- ❌ 不要用屏幕像素坐标存储裁切框位置，必须用 scene 坐标
- ❌ 不要让摄像头权限失败阻断麦克风录制，三种采集流必须独立降级
- ❌ 不要在帧渲染阶段实时合成人像，人像叠加必须在 ffmpeg 导出阶段处理
- ❌ 不要在标签页切换时自动暂停录制

---

## 当前开发状态（v0.1）

- [x] 项目脚手架搭建
- [ ] F1 录制基础功能（操作事件采集 + 音频采集）
- [ ] F1 IndexedDB 持久化
- [ ] F1.2 画幅比例设置面板 + 裁切框预览组件
- [ ] F1.2 scene 坐标系裁切框拖拽
- [ ] F1.3 人像窗口采集（useCamera.ts）
- [ ] F1.3 CameraWindow 浮窗组件（可拖拽 + 双击隐藏）
- [ ] F2 操作序列 Web 回放播放器（含比例裁切）
- [ ] F2 MP4 导出（ffmpeg.wasm，含比例 + 人像叠加）
- [ ] F3 Whisper 字幕生成
- [ ] F3 字幕 SRT 下载
- [ ] F4 讲义 AI 生成
- [ ] F4 讲义 Markdown/PDF 导出
