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

- ScreenCaptureKit 获取屏幕/窗口，VideoToolbox 硬件 H.264/HEVC，AVFoundation 获取独立摄像头与麦克风轨。
- 录制前真实预热并生成能力报告；不能确认稳定时明确阻止或让用户选择，不静默软编/降质。
- 有界队列只保留最新帧；短分段顺序落盘、原子 manifest、崩溃扫描恢复；系统音频只写一次。
- 录制期间资源隔离：禁止上传、AI、ASR、导出和素材预取。
- 测试：队列上限、每帧释放、分段恢复、磁盘不足、安全停止、A/V 连续性。

## 阶段 4：完整 Excalidraw 桌面透明白板

- 直接挂载现有 `Whiteboard`/Excalidraw scene，保留全部工具、库、快捷键、文件和协作能力。
- AppKit 管理透明置顶、多屏、点击穿透和 ScreenCaptureKit exclusion；React 管理场景与输入。
- 记录场景增量、指针、激光、缩放；导出时 60fps 重放并合成，录后可改透明度。
- 测试：工具能力清单、场景往返、背景/笔迹透明度独立、窗口排除、无实时 Canvas 捕获。

## 阶段 5：AI Camera 与刘海智能提词器

- 摄像头保存独立轨；原生预览窗口从屏幕捕获排除，录后应用形状、背景与 Auto Director 镜头。
- 复用现有提词器讲稿、匹配、高亮、Google/Vosk 回退逻辑；录制中只消费共享 mic PCM。
- AppKit 提词器窗口吸附刘海/菜单栏中心，支持多显示器、置顶、排除捕获；识别失败回退常速滚动。
- 测试：不重复申请麦克风、关开恢复、跳读/回读、吸附几何、多显示器与捕获排除。

## 阶段 6：教学 Director 与 ChatCut Recipe

- 录前选择教学素材包和能力开关，可固定具体素材；Library 全量可搜索，AI 自动选材只限 curated pack。
- DeepSeek 产出章节、要点、证据时间、图表结构和素材槽位；ChatCut API/SDK 解析为版本化非破坏 `EditRecipe`。
- 自动创建屏幕、白板、摄像头、字幕、图表、动效、音效、音乐和镜头轨；高层按钮可重编排，时间线仍完整可编辑。
- 测试：素材白名单、确定性落轨、证据时间、撤销/重生成、服务失败保留原始项目。

## 阶段 7：Excalicast Studio UI 与浏览器全量迁移

- 项目库首页、紧凑录前设置、中央预览、右侧 Director、底部时间线、可折叠素材库。
- 建立桌面 design tokens、状态与动效规范；深色外壳、暖纸舞台、黄色强调，达到 Screen Studio 级信息层级和精细度。
- 对迁移矩阵逐项执行共享/适配/原生验收；Browser build 行为不得回归。
- 测试：键盘/可访问性、窗口尺寸、多语言、视觉快照、浏览器与桌面项目互开。

## 阶段 8：端到端与发布门槛

- Mac 1440p30 + 48kHz 麦克风 + 720p 摄像头连续 60 分钟；另测 4K60 能力档和外接显示器。
- 内存不随时长线性增长；无音频缺口；分段可恢复/拖动；停止后三秒内进入编辑器。
- 主线程 p95 < 50ms；同时复制本地文件和大文件下载时吞吐至少为空闲基线 70%；录制不导致断网或持续系统卡顿。
- 对白板、提词器、摄像头窗口做捕获排除验收；全量 Web 测试、Swift 测试、Electron E2E、签名/公证/权限文案全部通过后才可发布。

