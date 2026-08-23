# Mac AI 教学录制工作室实施计划

> 本计划取代 `2026-08-10-macos-professional-client.md`。执行规则：每一阶段先写失败测试，再做最小实现；阶段测试与全量类型检查通过后自动进入下一阶段。

## 架构边界

```text
Electron main / preload
  ├─ React shared editor UI（完整浏览器功能）
  ├─ Excalidraw transparent overlay renderer
  └─ versioned IPC
       └─ Swift MacMediaEngine
            ├─ ScreenCaptureKit + VideoToolbox
            ├─ AVFoundation camera/mic
            ├─ segmented media store + recovery
            └─ AppKit overlay / camera / notch windows
```

原始屏幕帧不得进入 React、Canvas 或 Electron IPC。实时层只采集基础媒体和遥测；白板、摄像头造型、背景、Autozoom、动效、字幕与 ChatCut 素材在预览/导出阶段确定性合成。

## 2026-08-23 计划审计结论

本计划必须以“Stop 后无需时间线操作即可得到可发布教学视频”为交付终点，不能把 IPC、轨道元数据或 UI 入口视为能力完成。最新 PRD 明确要求的数据主链此前没有被拆成独立阶段，现补齐为：

`Pixel/Audio + Unified Event Clock → Scene/ROI → Attention Timeline → Semantic Director → Deterministic Camera Planner → Cleanup → Local Renderer → Video Ready`

以下项目是发布阻断项：

- 原生项目必须能流式预览、seek 和导出真实媒体；不允许把 60 分钟分片整段读进 Renderer 内存。
- Display / Window / Region、pause/resume、mic/system/camera mute、设备断连与恢复必须达到 Web 能力等价或更强；暂未实现的原生控制不得用提示框冒充完成。
- 必须记录 active window、window bounds、cursor、click、scroll、Ink、undo、mode change，并统一映射到单调媒体时钟。
- 必须真正生成并消费 `attention.json`、`camera.json`、`cleanup.json`；只生成素材 placement 或只在 Timeline 显示轨道不算一键成片。
- ChatCut 不得只接三个硬编码示例素材；需要版本化目录、录前显式预选、授权/缓存/失效策略和录后内容替换、真实渲染及音频混合。
- 必须在目标 Mac 上完成摄像头 + 系统音频 + 麦克风并发的 60 分钟真机测试，以及磁盘复制/大文件下载并发测试；契约测试不能替代性能验收。
- 正式下载必须指向真实存在、Developer ID 签名并完成 Apple 公证的 DMG；官网 `fix/loading-recording` 下载入口、Release 资产、SHA256 与自动更新元数据必须形成闭环。

## 阶段 1：产品、迁移与 IPC 契约

- 建立机器可验证的浏览器能力迁移矩阵，发布不得出现 `omitted`。
- 固化完整 Excalidraw 桌面白板契约：`engine=excalidraw`、全工具面、Ink/Full Board、背景和笔迹透明度独立。
- 固化版本化 IPC channel、录制 manifest、capability/pressure、教学 Recipe 与提词器会话类型。
- 测试：契约完整性、schema 迁移、未知版本拒绝、透明度边界。

## 阶段 2：Desktop Shell 与 Swift Helper 生命周期

- 新增 `apps/desktop`，Electron main/preload 使用窄桥接 API；renderer 复用共享 React 组件。
- 新增 `native/mac-media-engine` Swift Package 和可执行 Helper，支持 handshake、健康检查、优雅停止与异常重启。
- IPC 使用结构化消息和 correlation id；媒体只传文件引用/状态，不传 Blob/帧。
- 测试：启动/退出、协议不匹配、Helper 崩溃、重复 stop 幂等。

## 阶段 3：原生录制与恢复

- ScreenCaptureKit 获取屏幕/窗口/选区，VideoToolbox 硬件 H.264/HEVC，AVFoundation 获取独立摄像头与麦克风轨。
- 录制前真实预热并生成能力报告；不能确认稳定时明确阻止或让用户选择，不静默软编/降质。
- 有界队列只保留最新帧；短分段顺序落盘、原子 manifest、崩溃扫描恢复；系统音频只写一次。
- 所有媒体轨使用统一单调时钟；暂停期间项目时间不推进，60 分钟末端 A/V drift 目标 <100ms。
- 补齐原生 pause/resume、mic mute、system-audio mute、camera hide/hardware off、设备切换与断连恢复；控制状态写入事件轨。
- 录制期间资源隔离：禁止上传、AI、ASR、导出和素材预取。
- 测试：队列上限、每帧释放、分段恢复、磁盘不足、安全停止、A/V 连续性。

## 阶段 3.5：Unified Event Data Plane

- 定义版本化 Unified Event Schema 与唯一单调媒体时钟映射，记录 active window、window bounds、display/space、cursor、click、dwell、scroll、Ink、undo、mode change、camera/control state。
- 事件使用有界批次追加到 `events.ndjson`/SQLite；高频 cursor/pen 不走 React 状态，不因录制时长线性增长内存。
- 建立 screen-fixed、window-fixed、world-fixed 坐标转换；窗口移动、resize、多屏缩放和 Retina 坐标必须可重放。
- 为 accessibility tree、局部 OCR 和稀疏关键帧预留版本化 ROI 输入，但录制热路径不得运行重型视觉分析。
- 测试：跨轨时间对齐、乱序拒绝/修复、窗口 resize 坐标、暂停时钟、事件恢复和一小时有界内存。

## 阶段 4：完整 Excalidraw 桌面透明白板

- 直接挂载现有 `Whiteboard`/Excalidraw scene，保留全部工具、库、快捷键、文件和协作能力。
- AppKit 管理透明置顶、多屏、点击穿透和 ScreenCaptureKit exclusion；React 管理场景与输入。
- 记录场景增量、指针、激光、缩放；导出时 60fps 重放并合成，录后可改透明度。
- 测试：工具能力清单、场景往返、背景/笔迹透明度独立、窗口排除、无实时 Canvas 捕获。

### 当前实施检查点（2026-08-23）

- 阶段 1–3 的契约、Desktop Shell、原生分轨录制、恢复、媒体连续性校验、资源抢占和浸泡测试工具已经提交到独立分支。
- 阶段 4 已完成透明置顶 Excalidraw 全工具窗口、捕获排除、增量事件轨、原生分片读取、确定性 60fps seek/replay，以及预览/导出合成；屏幕视频与白板事件可录后重新合成，背景和笔迹透明度保持独立可调。
- 本检查点通过 30 项桌面契约测试、73 项媒体/导出回归、3 项真实页面端到端测试、Web/Desktop TypeScript 构建和 Next.js 生产构建。
- 当前 macOS 会话锁定时，ScreenCaptureKit/摄像头/麦克风/系统音频的正向真机采集验收延后到会话解锁后执行；负向权限、恢复、连续性与资源压力测试不受影响。

## 阶段 5：AI Camera 与刘海智能提词器

- 摄像头保存独立轨；原生预览窗口从屏幕捕获排除，录后应用形状、背景与 Auto Director 镜头。
- 同一 AVFoundation 会话同时服务完整摄像头轨与预览；支持气泡/完整人像事件、Vision 平滑取景、隐藏与真正关闭硬件，不重复打开设备。
- 复用现有提词器讲稿、匹配、高亮、Google/Vosk 回退逻辑；录制中只消费共享 mic PCM。
- AppKit 提词器窗口吸附刘海/菜单栏中心，支持多显示器、置顶、排除捕获；识别失败回退常速滚动。
- 测试：摄像头开启后 manifest 真实存在独立分片、不重复申请麦克风、关开恢复、跳读/回读、吸附几何、多显示器与捕获排除。

## 阶段 6：Attention Engine 与确定性 Camera Planner

- Scene Segmenter 先根据窗口切换、页面/空间变化、稳定 scroll、Ink 和控制事件划分上下文；低置信度场景默认 Full Context。
- ROI 候选优先来自 Ink bbox、click+dwell、window/panel bounds，再按需使用 accessibility/OCR/稀疏视觉；LLM 只能在候选中选择并输出严格结构化 intent。
- 建立 `attention.json`，至少融合 InkActivity、SpeechReference、ClickDwell、WindowFocus、Recency、MotionNoise 与 UIControlPenalty。
- 确定性 Planner 生成 FULL_CONTEXT / FOCUS / FOLLOW / REVEAL / HOLD，并强制 minimum shot duration、cooldown、hysteresis、sustain、safe zone、速度/加速度和最大 zoom。
- 支持 Calm / Balanced / Dynamic 三档；同一输入和同一策略必须生成等价 `camera.json`，可通过“这里别放大/少一点 Zoom/保留上下文”重算而不改源素材。
- 测试：PRD 四条基础 Camera Rule、低置信度 HOLD/FULL、镜头无抖动、重复运行确定性、黄金人工 ROI benchmark。

## 阶段 7：Auto Cleanup、教学 Director 与 ChatCut Recipe

- 录前选择教学素材包和能力开关，可固定具体素材；Library 全量可搜索，AI 自动选材只限 curated pack。
- 录后转写产生 word/segment 时间戳和 EMPHASIS / SHIFT / RETURN / SUMMARY；AI 只做低频语义补充，不逐帧读取整段视频。
- DeepSeek 产出章节、要点、证据时间、图表结构和素材槽位；ChatCut API/SDK 解析为版本化非破坏 `EditRecipe`，并对图表/标题等素材执行真实内容替换。
- ChatCut catalog 保存素材版本、来源、许可、校验和、缓存和失效状态；用户未预选的类别不得隐式注入。
- 自动创建屏幕、白板、摄像头、字幕、图表、动效、音效、音乐和镜头轨；高层按钮可重编排，时间线仍完整可编辑。
- Auto Cleanup 先处理 undo/erase、确定性 dead time、静默窗口整理与 loading；宁可少删，不自动删除高风险口误，所有删除均可恢复。
- 测试：素材白名单、目录版本与离线缓存、确定性落轨、真实渲染/混音、证据时间、撤销/重生成、误删保护、服务失败保留原始项目。

## 阶段 8：原生媒体适配、本地合成与一键成片

- 通过受限 `excalicast-media://` 或等价本地协议提供 Range 读取、seek、代理和波形；Renderer 只拿媒体 URL/轻量状态，不接收整段 ArrayBuffer。
- 原生项目的 screen、camera、mic、system-audio 与 Ink/event 轨进入同一编辑/预览构图契约；旧 IndexedDB/WebM 项目继续兼容。
- Metal/Core Image/AVAssetReader/Writer/VideoToolbox 消费 `camera.json`、`cleanup.json`、字幕、白板、摄像头和 ChatCut Recipe，生成可恢复的本地预览和最终成片。
- Stop 后先给 rough preview，再并行精炼语义；默认进入 Generating/Video Ready，不要求用户进入 Timeline，完整编辑器作为可选高级入口继续保留。
- 测试：60 分钟 seek 内存有界、四轨同步、预览/导出黄金帧、导出任务后台存活、失败恢复、三秒内进入可预览状态。

## 阶段 9：Excalicast Studio UI 与浏览器全量迁移

- 项目库首页、紧凑录前设置、中央预览、右侧 Director、底部时间线、可折叠素材库。
- 建立桌面 design tokens、状态与动效规范；深色外壳、暖纸舞台、黄色强调，达到 Screen Studio 级信息层级和精细度。
- 对迁移矩阵逐项执行共享/适配/原生验收；Browser build 行为不得回归。
- 增加首次权限引导、设备/磁盘/编码能力诊断、恢复中心、项目删除/空间管理、隐私与云端上传开关。
- 测试：键盘/可访问性、窗口尺寸、多语言、视觉快照、权限拒绝恢复、浏览器与桌面项目导入/互开。

## 阶段 10：评测、数据闭环与产品质量门槛

- 建立 50–100 条真实教学录制 benchmark 和专业剪辑师 Ground Truth，持续评估 Focus ROI、shot type、cleanup 与上下文保留。
- 记录 One-pass Publish Rate、Manual Intervention Rate、Focus Precision、Unnecessary Camera Moves、Context Loss Rate、Undo Cleanup Precision 和 Time-to-Preview。
- Pilot 门槛：One-pass Publish Rate >70%，每 10 分钟 Camera 人工修正 ≤2，Focus Precision >90%，Context Loss <5%。
- 用户接受/重算/反馈数据本地优先并需明确同意；未来 Attention Ranker 训练不进入 MVP 阻断路径。

## 阶段 11：端到端、分发与发布门槛

- Mac 1440p30 + 48kHz 麦克风 + 720p 摄像头连续 60 分钟；另测 4K60 能力档和外接显示器。
- 内存不随时长线性增长；无音频缺口；分段可恢复/拖动；停止后三秒内进入编辑器。
- 主线程 p95 < 50ms；同时复制本地文件和大文件下载时吞吐至少为空闲基线 70%；录制不导致断网或持续系统卡顿。
- 对白板、提词器、摄像头窗口做捕获排除验收；全量 Web 测试、Swift 测试、Electron E2E、签名/公证/权限文案全部通过后才可发布。
- Developer ID 签名、公证、staple、Gatekeeper、SHA256、GitHub Release 固定资产名与官网 `fix/loading-recording` 下载重定向必须逐项验证；不存在签名/公证失败后发布未签名正式包的降级路径。
- 自动更新支持签名校验、灰度、回滚，录制/导出期间不得强制重启；崩溃诊断默认脱敏且需提供导出诊断包入口。
