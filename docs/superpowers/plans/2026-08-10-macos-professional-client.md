# Excalicast macOS 专业客户端重构计划（已被取代）

> 当前唯一执行计划为 `2026-08-23-macos-ai-teaching-studio.md`。本文件只保留历史参考；新计划补齐完整浏览器能力迁移、完整 Excalidraw 透明白板、刘海智能提词器、教学 Director、ChatCut Recipe 与 Screen Studio 级原生录制验收。

> 状态：架构规划稿
> 日期：2026-08-10
> 目标基线：`codex/recovered-53c2@1c5122d`

## 1. 已锁定决策

- Mac 客户端与网页版并行，不替代现有 Web 产品。
- 首版通过官网直接分发，不进入 Mac App Store。
- 使用 Developer ID 签名、公证和应用内自动更新。
- 首版仅支持 Apple Silicon，最低系统版本为 macOS 13。
- 技术路线采用 Electron 界面壳 + Swift 原生媒体引擎。
- 官网、SEO、管理后台、API、支付 Webhook 继续由现有 Next.js 应用承担。
- Mac 客户端定位为更强的专业录制、编辑和导出客户端。
- 摄像头、录制控制条、全局提词器是三个独立窗口，不得合并。

## 2. 目标与非目标

### 2.1 目标

- 复用现有 React、Excalidraw、录制设置、导出编辑器、Timeline、字幕、背景和权益界面。
- 使用 ScreenCaptureKit 稳定录制显示器、应用窗口、单个窗口和选区。
- 使用 AVFoundation 采集麦克风和高质量完整摄像头画面。
- 使用 VideoToolbox、AVAssetReader/Writer 和 Metal/Core Image 替代浏览器逐帧导出瓶颈。
- 提供真正的系统级快捷键、圆形摄像头浮窗、录制控制条和全局提词器。
- 录制中实时切换“完整人像”和“录制画面 + 摄像头气泡”，并可在后期修改切换点。
- 保证浮窗对用户可见，但不会被录入屏幕源。
- 录制素材和分析默认保留在本机，云同步仍为显式功能。
- 页面、窗口关闭、应用崩溃、睡眠唤醒和设备断开后能够恢复或安全收尾。

### 2.2 非目标

- 首版不支持 Windows、Linux、Intel Mac 或 macOS 12。
- 不重写官网、SEO 内容、管理后台和服务端业务 API。
- 不在首版将 Excalidraw 改写为 Swift 原生白板。
- 不在首版进入 Mac App Store，也不接入 StoreKit。
- 不使用远程网页作为桌面客户端主 Renderer。
- 不把摄像头浮窗或提词器像素直接烧录进屏幕视频；最终成片由独立媒体轨与事件重建。

## 3. 推荐总体架构

```text
apps/
  web/                       Next.js 官网、SEO、管理后台、公开页面和 API
  desktop/
    main/                    Electron 主进程、窗口、菜单、快捷键、更新、深链接
    preload/                 最小白名单 IPC 桥
    renderer/                复用 React/Excalidraw 的桌面产品界面

packages/
  editor-ui/                 录制设置、白板、导出页、Timeline、背景、字幕
  recording-domain/          录制配置、取景、场景事件、裁切、摄像头位置
  project-format/            桌面项目清单、版本迁移和校验
  api-client/                登录、权益、支付、ASR、分享和云同步
  composition-contract/      预览与原生导出的统一构图数据契约

native/
  mac-media-engine/          Swift 原生可执行 Helper
    capture/                 ScreenCaptureKit
    camera/                  AVFoundation、Vision、摄像头 NSPanel
    audio/                   麦克风、系统音频、同步时钟
    compositor/              Metal/Core Image
    export/                  AVAssetReader/Writer、VideoToolbox
    project-store/           文件分片、SQLite、崩溃恢复
```

### 3.1 进程职责

- Electron Main 只负责应用生命周期、窗口、系统菜单、快捷键、权限跳转、自动更新和原生 Helper 生命周期。
- Electron Renderer 只负责 UI、编辑意图和轻量预览，不直接访问 Node、磁盘或系统级 API。
- Swift Helper 直接把媒体写入项目目录，只通过 IPC 返回状态、进度、诊断和轻量预览句柄。
- Next.js 服务端继续处理 Supabase、支付、Webhook、ASR、Dubbing、分享和云端录制注册。
- 原始视频帧不通过 JSON 或 Electron IPC 来回搬运。

### 3.2 IPC 原则

- 使用版本化命令和事件协议，例如 `capture.start.v1`、`camera.setLayout.v1`、`export.start.v1`。
- 命令必须携带 `sessionId` 或 `taskId`，响应必须可关联、可取消、可幂等重试。
- 大媒体只传受控文件 URL、文件描述符或本地资源 ID，不传 Base64 和 ArrayBuffer。
- Preload 仅暴露白名单 API，开启 `contextIsolation`、Renderer sandbox 和严格 CSP。
- Helper 意外退出时，Main 负责标记会话中断、保留已落盘分片并提供恢复入口。

## 4. 现有 Web 模块如何处理

| 当前能力 | Mac 客户端处理方式 |
| --- | --- |
| Next.js 营销、SEO、内容页 | 保留在 Web，不打进客户端 |
| `/app` 白板与录制设置 | 拆入共享 `editor-ui`，Mac Renderer 复用 |
| `/export/[id]` 编辑器 | 复用 UI，媒体读取和导出改走原生桥 |
| `/library` | UI 复用，数据源改为本地项目索引 + 可选云列表 |
| IndexedDB/Dexie | Web 继续使用；Mac 改为项目目录 + SQLite |
| `getDisplayMedia` | Mac 改为 ScreenCaptureKit |
| `getUserMedia` 摄像头 | Mac 改为 AVFoundation |
| MediaRecorder WebM | Mac 改为硬件编码的分段 MP4/MOV |
| Document PiP | Mac 改为独立原生浮窗 |
| WebCodecs/ffmpeg.wasm | Web 保留；Mac 改为 VideoToolbox 与 AVFoundation |
| localStorage 设置 | Mac 改为版本化 Preferences；敏感数据存 Keychain |
| 浏览器下载 | Mac 改为 NSSavePanel 和原生文件写入 |
| Supabase 浏览器会话 | Mac 使用 PKCE + 深链接，令牌进入 Keychain |
| Paddle/Creem Overlay | 默认外部浏览器结账，Webhook 确认权益后客户端刷新 |

## 5. 原生录制引擎

### 5.1 屏幕与窗口录制

- 使用 ScreenCaptureKit 枚举显示器、应用和窗口，构建原生来源选择器。
- 支持显示器、应用、窗口和选区；选区保存为源分辨率归一化坐标。
- 录制源保持非破坏性完整素材，选区和比例作为 metadata 应用于预览和导出。
- 使用 `SCContentFilter` 排除 Electron 主窗口、录制控制条、摄像头浮窗和提词器窗口。
- 系统音频与屏幕视频共享主时钟，麦克风保留为独立轨道。
- 显示器断开、分辨率变化、空间切换和窗口关闭均写入结构化诊断并安全终止或切换来源。

### 5.2 媒体文件与时钟

- 每次录制建立独立项目目录，不再将大型 Blob 写入 IndexedDB。
- 屏幕、摄像头、麦克风和系统音频各自使用可恢复的短分片。
- 所有轨道统一到单调 `CMClock` 时间轴，暂停期间不推进项目时间。
- 每个分片写入后原子更新 manifest，应用崩溃时最多损失当前未完成分片。
- 首版使用硬件 H.264 作为屏幕和摄像头中间格式，兼顾 Electron 预览与原生导出兼容。
- 麦克风和系统音频分轨保存，编辑器可独立静音、调整增益和显示波形。

### 5.3 白板录制

- Excalidraw 继续使用事件快照、二进制资源和激光笔轨迹，不强制录制成屏幕视频。
- 快照与媒体轨使用同一项目时钟。
- 可选工作区外壳仍由 Renderer 生成视觉状态，但保存为结构化数据或稀疏关键帧。
- 白板模式同样可以使用原生摄像头、麦克风、控制条和全局提词器。

## 6. 摄像头专项设计

### 6.1 采集原则

- AVFoundation 始终采集完整摄像头画面，默认 1920x1080、30fps、H.264 硬件编码。
- 气泡只是完整画面上的裁切、形状、位置和尺寸 metadata，不生成低清方形源。
- 预览默认镜像，最终导出默认保持当前产品的镜像策略，并在设置中允许关闭。
- 设备、分辨率、帧率和色彩空间在录制开始前锁定；设备失效时尝试一次恢复。
- 完整人像和气泡共用同一摄像头会话，不重复打开摄像头。

### 6.2 独立摄像头窗口

- 使用透明、无标题栏、置顶的原生 `NSPanel`，与录制控制条和提词器完全分离。
- 气泡态使用真正圆形或小圆角蒙版；透明区域不拦截鼠标事件。
- 支持拖动、缩放、吸附屏幕边缘和记忆每个显示器的位置。
- 窗口进入全屏应用、多个 Space 和多显示器时保持在当前录制显示器上。
- ScreenCaptureKit 明确排除该窗口，屏幕源中不出现气泡或动画残影。
- 最终导出根据摄像头轨和布局事件重新合成，所以用户后期仍可调整位置和切换点。

### 6.3 完整人像与气泡切换

- 初始布局为 `content_with_bubble`。
- 切换到 `full_presenter` 时，人像从当前气泡平滑扩展到背景内的固定视频主体框。
- 完整人像使用 cover 铺满主体框，Vision 人脸检测提供平滑的智能裁切中心。
- 四周所选视频背景保持可见，录制内容在完整人像下方继续采集，不丢失任何素材。
- 再次切换时，人像在 420ms 内缩回最后选定的气泡位置、大小和形状，录制内容同时恢复可见。
- 动画采用 `easeInOutCubic`；预览、分享和最终导出读取同一事件，不依赖窗口动画录像。
- 手动 Autozoom 只作用于录制内容纹理，不改变固定主体框和完整人像布局。

```ts
type PresenterLayout = 'content_with_bubble' | 'full_presenter';

interface PresenterSceneEvent {
  id: string;
  timestampMs: number;
  layout: PresenterLayout;
  bubblePlacement: CameraPlacementV2;
  bubbleShape: 'circle' | 'rounded';
  transitionMs: 420;
  easing: 'easeInOutCubic';
  presenterFocus?: { x: number; y: number; confidence: number };
}
```

- 场景事件进入独立 Timeline 轨道，允许移动、删除和补加。
- 同一时间戳的多次切换采用最后一次操作，避免暂停状态下产生零长度片段。
- 旧录制没有该轨道时默认全程 `content_with_bubble`，无需破坏性迁移。

### 6.4 快捷键和控制

- Renderer 获得焦点时保留 `Shift+C` 作为快速切换。
- 系统全局默认改为 `Command+Shift+C`，避免裸 `Shift+C` 截获其他应用中输入的大写 C。
- 用户可在偏好设置中重新绑定；注册冲突时显示明确错误并保留录制条按钮。
- 录制控制条增加人像/画面切换按钮，并显示当前布局状态。
- 暂停时允许预设下一布局，但事件落在恢复录制的当前项目时间点。
- 摄像头被隐藏、硬件关闭或轨道失败时，完整人像模式自动退回录制内容。

### 6.5 隐藏与关闭硬件

- “隐藏摄像头”只隐藏画面，摄像头会话继续运行，可即时恢复和切换完整人像。
- “关闭摄像头硬件”真正停止 AVCaptureSession 和摄像头指示灯，恢复时允许出现重新初始化延迟。
- 完整人像状态下执行隐藏或关闭硬件时，先动画回到录制内容，再关闭摄像头画面。
- 应用退出、录制停止或 Helper 崩溃时必须停止会话并释放设备。

## 7. 全局提词器专项设计

### 7.1 能力边界

- 提词器是独立原生置顶窗口，可覆盖在任意应用、窗口或全屏 Space 上。
- 提词器窗口与摄像头窗口、录制控制条互不依赖，可单独显示、隐藏和移动。
- ScreenCaptureKit 始终排除提词器窗口；提词文本不会进入录制和最终导出。
- 继续复用现有讲稿分词、中英文匹配、Vosk 离线跟读和当前词高亮算法。
- 不继续使用 Document PiP；窗口宿主改为 Electron `BrowserWindow` 或原生 `NSPanel`。

### 7.2 窗口模式

- `docked`：当前显示器顶部居中的窄条，适合录制时阅读。
- `expanded`：可编辑讲稿、调整速度、字体、透明度、语言和跟读方式。
- `floating`：自由拖动的纵向或横向面板。
- `locked`：锁定位置并启用点击穿透，避免操作其他应用时误拖动。
- 每个显示器分别记忆位置、宽度、模式和缩放；显示器断开时迁移到主显示器安全区。
- 刘海屏读取可见工作区和 safe area，不把文字放到摄像头刘海或菜单栏下方。

### 7.3 滚动和跟读

- 保留自动匀速滚动和语音跟读两种模式。
- 原生录制引擎将同一麦克风 PCM 通过有界音频环形缓冲提供给跟读 Worker，禁止第二次打开麦克风。
- Vosk 模型继续本地懒加载和缓存；模型不可用时回退匀速滚动，不阻塞录制。
- 当前词、高亮位置和滚动进度以低频状态事件同步到提词器 Renderer，不传完整媒体。
- 支持暂停跟读、回退一句、前进一句、重置到开头和从指定段落开始。
- 录制暂停时提词器默认同步暂停；用户可在偏好设置中选择继续滚动。

### 7.4 全局快捷键

- `Command+Shift+T`：显示或隐藏全局提词器。
- `Command+Option+Space`：开始或暂停滚动/跟读。
- `Command+Option+Up/Down`：上一句或下一句。
- `Command+Option+Left/Right`：降低或提高滚动速度。
- 所有快捷键均可重绑定；冲突时不静默失败。
- 提词器锁定后仍可通过全局快捷键解锁或隐藏。

### 7.5 状态持久化与隐私

- 讲稿、语言、速度、字号、透明度和窗口布局保存到本地 Preferences/SQLite。
- 讲稿默认不上传云端；只有用户显式开启同步时才进入加密云同步范围。
- 跟读音频仅在内存环形缓冲中使用，不额外落盘，也不发送给远程服务。
- 关闭提词器不能停止录制麦克风；停止录制后按提词器是否仍在跟读决定是否释放共享音频订阅。

## 8. 编辑、预览和原生导出

### 8.1 统一构图契约

- TypeScript 负责生成版本化 Composition Project JSON。
- 原生导出器只消费该契约，不直接理解 React 状态或 IndexedDB 结构。
- 契约包含输出比例、背景、固定视频主体框、内容裁切、Autozoom、摄像头、场景切换、字幕、水印和音轨。
- Web 预览和原生导出必须通过黄金帧测试验证同一时间点的构图误差。

### 8.2 预览

- 首阶段继续使用 React/Canvas 预览，媒体由只读 `excalicast-media://` 协议提供 Range 读取。
- 播放、seek 和当前帧只保持一个会话，避免重复读取完整媒体。
- 长视频性能不足时，原生 Helper 生成编辑代理和波形，不修改原始素材。
- 背景、字幕、Autozoom 和场景切换更新必须可在分析任务运行时独立响应。

### 8.3 导出

- 使用 AVAssetReader 顺序解码屏幕、摄像头和音频轨。
- Metal/Core Image 合成背景、固定主体框、Autozoom、人像、字幕和水印。
- VideoToolbox 硬件编码 H.264/HEVC，AVAssetWriter 完成音视频封装。
- 不再生成成千上万张 JPEG，不使用 ffmpeg.wasm 虚拟文件系统。
- 导出任务由 Helper 独立持有，切换页面、隐藏主窗口或 Renderer 重载不能中断。
- 任务状态持久化；应用退出时提示继续后台导出或取消，异常退出后可恢复未完成任务。

## 9. 本地项目与旧数据迁移

### 9.1 项目目录

```text
~/Movies/Excalicast/Projects/<recording-id>.excalicast/
  manifest.json
  project.sqlite
  media/screen/*.mp4
  media/camera/*.mp4
  media/mic/*.m4a
  media/system/*.m4a
  derived/proxy/
  derived/waveform/
  derived/cursor/
  assets/backgrounds/
```

- SQLite 保存轻量索引、事件和任务状态；媒体文件不进入数据库 Blob。
- `manifest.json` 保存格式版本、项目 ID、所有者、校验和和恢复状态。
- Derived 数据可随时删除并重新生成，不参与云端事实数据。
- 文件写入使用临时文件 + 原子 rename，避免断电留下假完成文件。

### 9.2 Web 录制迁移

- 网页端增加“导出 Excalicast 项目包”，将 IndexedDB 录制转为版本化归档。
- Mac 客户端支持导入项目包并转换为本地项目目录。
- 不尝试直接读取 Chrome/Safari 的 IndexedDB 文件，避免权限、版本和浏览器锁问题。
- 同一录制通过稳定 ID 去重；导入失败不删除源包。

## 10. 登录、支付、云端和更新

- 使用系统浏览器完成 Supabase PKCE 登录，回调到 `excalicast://auth/callback`。
- Refresh token 使用 macOS Keychain；Renderer 不能直接读取令牌。
- Paddle/Creem 继续由数据库支付开关决定，客户端不复制支付路由规则。
- Checkout 使用系统浏览器，支付完成后由 Webhook 发放权益，客户端轮询或订阅权益变化。
- 单次购买绑定录制 ID；Pro/Max 权益与网页版共用同一账户事实来源。
- 自动更新包必须签名、公证并支持回滚；录制或导出中不自动重启更新。

## 11. 权限与生命周期

- 首次使用前分步解释并请求屏幕录制、摄像头和麦克风权限。
- 权限被拒绝时提供打开系统设置的入口和重新检测按钮。
- 权限变化、应用睡眠、锁屏、合盖、显示器拔插和摄像头断连均进入统一状态机。
- 关闭主窗口默认不退出正在进行的录制或导出；菜单栏显示当前任务状态。
- 用户退出应用时，如果正在录制，必须明确选择停止并保存、丢弃或返回。
- 强制退出或崩溃后，下次启动扫描 `recording/finalizing` 项目并执行恢复。

## 12. 实施阶段

### 阶段 0：架构拆分与契约

- 建立 monorepo 和共享包边界。
- 抽离 recording domain、editor UI、API client 和 composition contract。
- 保持 Web 行为不变并建立回归基线。

### 阶段 1：桌面壳与发布链路

- Electron Main/Preload/Renderer、安全策略、菜单、深链接和 Keychain。
- Developer ID 签名、公证、DMG、自动更新和崩溃日志。
- 打通 Supabase 登录和现有权益读取。

### 阶段 2：ScreenCaptureKit 与原生存储

- 来源选择、屏幕/窗口/选区、系统音频、麦克风和统一时钟。
- 项目目录、SQLite、媒体分片、停止收尾和崩溃恢复。
- 原生录制控制条和系统级暂停/停止快捷键。

### 阶段 3：摄像头与场景切换

- AVFoundation 摄像头录制、真正圆形 NSPanel 和窗口排除。
- 完整人像/气泡切换、Vision 智能裁切和场景事件轨道。
- 摄像头隐藏、硬关闭、设备切换和故障恢复。

### 阶段 4：全局提词器

- 独立置顶窗口、停靠/浮动/锁定/点击穿透和多显示器布局。
- 共享麦克风 PCM、Vosk 跟读、自动滚动和全局快捷键。
- 确认所有录制来源下提词器均不进入屏幕素材。

### 阶段 5：原生预览辅助与导出

- 本地媒体协议、代理、波形和长视频 seek。
- 原生合成、VideoToolbox 编码、后台导出和任务恢复。
- 完成背景、Autozoom、字幕、摄像头和多比例一致性。

### 阶段 6：专业功能与上线

- ChatCut、ASR、Dubbing、云同步和分享适配桌面项目。
- 旧 Web 项目包导入、诊断包、性能基准和灰度发布。
- 发布 Beta，收集权限失败、设备兼容和导出性能数据。

## 13. 测试与验收

### 13.1 摄像头

- 所有录制源、摄像头开关、比例、选区和多显示器组合均能显示并录到摄像头轨。
- 气泡拖动与缩放后，预览和导出位置误差不超过 2px。
- 完整人像切换在录制、预览和导出中时间误差不超过一帧。
- 切换动画期间背景和固定视频主体框不移动。
- 摄像头窗口、控制条和提词器在屏幕源中像素级不可见。
- 摄像头拔出、权限撤销、设备切换和硬件关闭不导致整段录制丢失。

### 13.2 提词器

- 在白板、标签页替代方案、应用窗口、桌面和选区录制时均保持置顶。
- 全屏应用、Space 切换和多显示器情况下窗口位置正确。
- 锁定态透明区域点击穿透，快捷键仍可隐藏或解锁。
- 录制与跟读只打开一次麦克风，停止提词器不会中断录制音频。
- 中英文跟读、高亮、跳读、重复、静音和模型失败均有稳定回退。
- 提词器在原始屏幕轨、预览和最终导出中均不可见。

### 13.3 录制与恢复

- 录制中关闭主窗口、退出 Renderer、睡眠唤醒、显示器断开和 Helper 崩溃。
- 30 分钟 4K 屏幕 + 摄像头 + 双音轨录制无无限写入队列或时间戳倒退。
- 异常退出后可恢复到最后完成分片，摄像头和麦克风无残留占用。

### 13.4 导出性能

- 三分钟 1080p/15fps 无效果导出目标不超过 60 秒。
- 三分钟 1080p/30fps，背景 + Autozoom + 摄像头 + 字幕目标不超过 120 秒。
- 页面切换、主窗口隐藏和提词器操作不暂停导出。
- 导出文件时长、音画同步、场景切换和字幕误差不超过一帧。

### 13.5 发布

- 全新安装、覆盖升级、自动更新、降级阻止、公证和 Gatekeeper 验证通过。
- 未授权、授权后重启、权限撤销和系统设置返回流程完整。
- Paddle/Creem 支付完成后由服务端权益生效，客户端不本地伪造付费状态。

## 14. 风险与控制

- 最大风险是 Web 预览与原生导出构图分叉；通过版本化构图契约和黄金帧测试控制。
- 第二风险是 Electron 与 Swift Helper 生命周期失配；通过会话 ID、心跳、幂等停止和项目恢复控制。
- 第三风险是多窗口在 Space/全屏/多显示器下失去位置；建立专门窗口协调器统一管理。
- 第四风险是录制媒体体积和磁盘压力；开录前估算空间，录制中持续监控并提前安全停止。
- 第五风险是全局快捷键冲突；所有注册结果必须可见、可重绑定并提供控制条后备入口。

## 15. 粗略工作量

- 单名资深工程师：约 5-7 个月达到可公开 Beta，完整专业能力约 8-10 个月。
- 两名工程师（桌面/原生媒体各一名）：约 3-4 个月 Beta，5-6 个月完成主要能力。
- 应优先交付“原生录制 + 摄像头 + 提词器 + 可恢复项目”，再替换原生导出；不要一次性大爆炸迁移。

## 16. 官方技术依据

- Electron Desktop Capturer：https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron Global Shortcut：https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron BrowserWindow：https://www.electronjs.org/docs/latest/api/browser-window
- Electron Security：https://www.electronjs.org/docs/latest/tutorial/security
- Apple ScreenCaptureKit：https://developer.apple.com/documentation/screencapturekit
- Apple AVFoundation Capture：https://developer.apple.com/documentation/avfoundation/avcapturesession
- Apple App Review Guidelines：https://developer.apple.com/app-store/review/guidelines/
