# 设计：屏幕录制重构（Excalicast v2）

> 状态：设计稿。基于 `feature/pro` 上的 commit `445e37e` 分叉。
> 工作分支：`feature/screen-record`，worktree 在 `.worktrees/screen-record`。

## Context（为什么做这件事）

### 现状的根本问题

当前 Excalicast 走「事件流 + 音频」的 scene-replay 架构：

- 录制 = Excalidraw 的 `onChange` 回调 + 麦克风 webm + 摄像头 webm + 工作区 DOM 快照
- 导出 = 把事件流逐帧重放为 PNG 序列，再 ffmpeg.wasm 合成 MP4

这套架构的设计初衷是**录制白板讲解**——内容只有白板，所以"录的不是屏幕、是数据"在那个范围内成立。

但用户的实际使用场景已经偏移了：他们想用 Excalicast 录**任何屏幕内容**做教程／演示／分享——VS Code、Figma、网页、第三方 app。scene-replay 完全做不到这件事，因为只能重渲染 Excalidraw 元素。

### 重新定位

产品定位换轨：从「白板录制工具」到「**面向创作者的网页屏录工具**」。核心使用路径：

```
打开 Excalicast → 点录制 → 系统选源（tab/窗口/桌面）
                ↓
              录视频 + 麦克风 + 摄像头气泡
                ↓
              停止 → 跳处理页 → 生成字幕 → 下载 MP4
                ↓
              发到抖音 / B 站 / 小红书 / YouTube
```

### 目标

- 用 `getDisplayMedia()` 真正录屏（用户可挑 tab/窗口/桌面）
- 视频、音频、字幕、大纲**全部本地**存储 + 生成；不上传到服务器（除字幕生成阶段临时把音频送 DashScope）
- 录制时支持比例预选 + 裁剪框定位
- 摄像头气泡可拖动，位置实时反映在最终视频里
- 输出 MP4（webm 转码）
- Pro 价值：去水印（**Pro 后可重下旧录制**，不需要重录）、字幕、大纲

### 反向约束（不再有的事）

- ❌ scene-replay 录制（新录制不走这条路径，但**旧录制保留唯读可回放**）
- ❌ 云端同步（所有 recordings_cloud / Storage bucket 整套废弃）
- ❌ 跨浏览器录制库
- ❌ 工作区 shell 快照（取代物是真正的屏幕录制）
- ❌ CLAUDE.md 里"绝对不用 getDisplayMedia"的约束（**反掉**——这是新架构的核心 API）

## 用户决策记录

| 问题 | 决策 |
|---|---|
| 是替换还是新增？ | **替换**（但保留旧录制唯读） |
| 云同步保留多少？ | **彻底删除**云同步；字幕 / 大纲本地生成本地存 |
| 录什么源？ | 完全释放系统选择器，用户挑 tab / window / 桌面 |
| 音频源？ | 麦克风默认 on，系统音频 toggle |
| 摄像头气泡合成？ | **实时合成**到 canvas → MediaRecorder（一条 webm） |
| 摄像头位置？ | 录制中可拖，实时反映 |
| 输出格式？ | **仅 MP4**（必经过 ffmpeg 转码） |
| 修剪首尾？ | v1 不做 |
| 比例选择？ | **保留**，录前选比例 → 选源 → 裁剪定位 → 开始录 |
| 旧录制标识？ | 不加徽标，新旧混合显示 |
| 水印 / 字幕烧入时机？ | **下载阶段** ffmpeg overlay（Pro 后可清水印） |
| 大纲生成？ | **v1 包含**（Pro 解锁，调 Deepseek） |

## 架构

### 实时录制管线

```
┌─────────────────────────────────────────────────────────┐
│  录制中（live composite, 主线程 + AudioContext）         │
│                                                           │
│  ┌────────────────┐    ┌─────────────────┐               │
│  │ getDisplay     │──→ │ Crop & Draw     │               │
│  │ Media stream   │    │  to OffscreenCv │               │
│  │ (Picker-chosen)│    │   (cropRect)    │               │
│  └────────────────┘    │                 │               │
│                         │  + cam bubble   │               │
│  ┌────────────────┐    │   (draggable)   │               │
│  │ getUserMedia   │──→ │                 │ ──→ Canvas    │
│  │ (camera)       │    │  (NO watermark, │   captureStream│
│  └────────────────┘    │   NO subtitle — │      ↓         │
│                         │   come later)   │   MediaRecorder│
│                         └─────────────────┘  ('video/webm; │
│                                               codecs=vp9,opus')│
│  ┌────────────────┐    ┌─────────────────┐      ↓         │
│  │ getUserMedia   │──→ │                 │   1s chunks    │
│  │ (mic)          │ ┐  │ AudioContext   │      ↓         │
│  └────────────────┘ ├→ │ mixer →        │   IndexedDB    │
│  ┌────────────────┐ │  │  destination    │   screenChunks │
│  │ getDisplayMedia│ ┘  │  (1 track out)  │                │
│  │ (system audio) │    └─────────────────┘                │
│  │ optional       │                                       │
│  └────────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

**关键不变量**：录制阶段的 webm 是「干净」的——只含真实拍到的内容（屏幕 + 摄像头 + 音频），**没有任何品牌叠加**。水印 / 字幕都是下载阶段的事。

### 录制开始的 UI 流程

```
[开始录制] (workspace 主页底部居中)
       ↓
┌─── RecordSetupModal ────────────────┐
│ 比例: ○ 原始  ○ 16:9  ● 9:16  ○ 1:1 │
│       ○ 4:5                          │
│                                       │
│ 音频:  ☑ 麦克风  ☐ 系统音频           │
│                                       │
│ 摄像头: ☑ 开启  📹 [位置: 右下]      │
│                                       │
│        [取消]  [选择录制源 →]         │
└───────────────────────────────────────┘
       ↓ 点「选择录制源」
       ↓ 调 navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' },  // hint
            audio: 用户选了系统音频 ? true : false,
         })
       ↓
[Browser 系统弹窗 — 用户选 tab/window/screen]
       ↓ 拿到 displayStream + (optional) systemAudio track
       ↓
┌─── RegionSelector ──────────────────────────┐
│  实时预览源画面                              │
│   ╔═══════════════════════════════════════╗ │
│   ║                                       ║ │
│   ║   ┌─────────┐← 9:16 锁定的裁剪框      ║ │
│   ║   │ ░░░░░░░ │    可拖、可缩放          ║ │
│   ║   │ ░░░░░░░ │    出框区域加深          ║ │
│   ║   │ ░░░░░░░ │                          ║ │
│   ║   └─────────┘                          ║ │
│   ║                                       ║ │
│   ╚═══════════════════════════════════════╝ │
│                                              │
│  裁剪输出: 1080×1920                         │
│  [← 换源]                  [● 开始录制]      │
└──────────────────────────────────────────────┘
       ↓ 点开始
       ↓
[录制中。屏幕只显示一个浮动 RecordingBar — 暂停/停止/计时 + 摄像头气泡]
       ↓ 点停止
       ↓ MediaRecorder.stop() → 等 final blob flushed
       ↓ router.push('/process/[id]')
```

**「原始」比例特例**：跳过 RegionSelector，整个源直接录。

### 处理页 `/process/[id]`

```
┌────────────────────────────────────────────────┐
│ ← 返回库      录制 abc123  · 4:32  · 9:16     │
├────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────┐  ┌─────────────────┐ │
│  │                       │  │  生成字幕        │ │
│  │   <video> 内嵌 webm   │  │  ├ [开始]       │ │
│  │   播放器（原生）       │  │  └ 进度…         │ │
│  │                       │  │                  │ │
│  │   ▶ 0:00 / 4:32      │  │  生成大纲 (Pro)  │ │
│  └──────────────────────┘  │  ├ [开始]       │ │
│                              │  └ 字幕已就绪    │ │
│  ┌────────────────────────┐ │                  │ │
│  │ ☑ 烧入字幕             │ │  [下载 MP4]      │ │
│  │ ☑ 水印 (Free) / 隐藏  │ │   → ffmpeg 转码   │ │
│  └────────────────────────┘ │   → 自动下载     │ │
│                              └─────────────────┘ │
└──────────────────────────────────────────────────┘
```

**下载流程**：
1. 从 IndexedDB 拼回 webm chunks
2. ffmpeg.wasm 转码 webm → MP4（H.264 / AAC）
3. 期间叠加（按 toggle）：
   - 水印（Pro 用户跳过）：复用现有 `drawFrostedWatermark` 思路在 ffmpeg `drawbox`+`drawtext` 链上画毛玻璃 `excalicast.cc`。位置：摄像头气泡在右下时水印放左下，否则右下（与现有逻辑一致）
   - 字幕（如选了烧入）：ffmpeg.wasm 不带 libass。采用 `drawtext` 滤镜 + 按 SRT 时间戳逐句的 enable 表达式（详见技术风险 R2）
4. 输出到内存 → `Blob` → 触发下载

### 数据模型变化

#### IndexedDB schema v6（新增）

```typescript
interface ScreenRecordingMetadata {
  id: string;                          // uuid
  kind: 'screen_capture';              // discriminator
  startedAt: number;
  durationMs: number;
  aspectRatio: '原始' | '16:9' | '9:16' | '1:1' | '4:5';
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  subtitleSrt?: string;
  outline?: string;                    // markdown
  thumbnail?: string;                  // base64 data URL
  status: 'recording' | 'done' | 'error';
  title?: string;
}

// 注：摄像头位置全程已实时合成进 webm 像素，不需要单独存事件流。

interface ScreenRecordingChunk {
  id?: number;                         // auto
  recordingId: string;
  index: number;
  blob: Blob;                          // webm chunk，~1s
}
```

#### 旧表保留

`recordings`, `snapshots`, `audioChunks`, `cameraChunks`, `binaryFiles`, `workspaceShells` 全部保留，read-only 模式：
- 库列表 query 两套表，按 startedAt 合并排序
- 旧录制点击 → 旧 `/play/[id]` 和 `/export/[id]`（不改）
- 新录制点击 → 新 `/process/[id]`
- 用户视觉上不区分（按用户意愿）

#### 云端清理

新 Supabase migration drop：
- 表 `public.recordings_cloud`
- bucket `recordings`（含所有 storage policies）

## Pro 权限重映射

| 权限 | Free | Pro |
|---|---|---|
| 录屏（任意比例 / 任意源） | ✅ | ✅ |
| 录制时长 | 无限 | 无限 |
| 麦克风 + 系统音频 + 摄像头 | ✅ | ✅ |
| 下载 MP4 | ✅（水印烧入）| ✅（无水印）|
| 字幕生成 | ❌ | ✅ |
| 大纲 / 章节生成 | ❌ | ✅ |
| Pro 后回看旧录制可去水印 | — | ✅ |

**关键不变量**：水印不在录制时烧；Free 用户买 Pro 后，对**任何**录制（包括 Free 时期录的）重下都是 clean。

## 关键文件清单

### 新建

| 文件 | 职责 |
|---|---|
| `src/services/screenRecording.ts` | 顶层 startScreenRecording / pause / resume / stop |
| `src/services/displayCapture.ts` | 封装 getDisplayMedia + 系统音频请求 |
| `src/services/liveComposite.ts` | OffscreenCanvas 实时合成（屏幕 crop + 摄像头）+ 音频混合（AudioContext）+ canvas.captureStream |
| `src/services/screenExport.ts` | webm → MP4，可选字幕烧入、可选水印 overlay |
| `src/services/outlineGenerator.ts` | 调 Deepseek 生成大纲（输入：字幕 + 关键帧截图） |
| `src/components/RecordSetupModal.tsx` | 比例 / 音频 / 摄像头预设 |
| `src/components/RegionSelector.tsx` | 裁剪定位（比例锁定的可拖拽框） |
| `src/components/RecordingControlBar.tsx` | 录制中浮动条（重写，更简） |
| `src/app/[locale]/process/[id]/page.tsx` | 处理页（播放 + 字幕 / 大纲 / 下载） |
| `supabase/migrations/2026_05_20_drop_cloud_recordings.sql` | drop recordings_cloud + bucket |

### 修改

| 文件 | 修改要点 |
|---|---|
| `src/lib/db-client.ts` | schema v6 + 新表 `screenRecordings` / `screenChunks` + helpers |
| `src/types/recording.ts` | 加新类型；保留旧类型 |
| `src/components/RecordingsList.tsx` | union 两套表展示；点击按 kind 跳不同路由；删掉云同步 / 全选 / 全部备份 UI |
| `src/app/[locale]/app/page.tsx` | 「开始录制」改成弹 RecordSetupModal，删旧 startRecording 调用；移除 Whiteboard / RecordingBar 旧实现的依赖（白板仍展示，但仅作 idle 装饰） |

### 删除 / 废弃

| 文件 | 处理 |
|---|---|
| `src/services/cloudSync.ts` | 删除 |
| `src/services/workspaceShellCapture.ts` | 删除 |
| `src/components/WorkspaceShellToggle.tsx` | 删除 |
| `src/app/api/recordings/register/route.ts` | 删除 |
| `src/app/api/recordings/list/route.ts` | 删除 |
| `src/app/api/recordings/[id]/route.ts` | 删除 |
| `src/lib/db.ts` 里 `recordings_cloud` 相关函数 | 删除（保留其他 Pro 表函数） |

### 保留（不动，给旧录制兜底）

| 文件 | 原因 |
|---|---|
| `src/services/recordingSession.ts` | 旧录制不会再新建，但旧的 IndexedDB 行还要能读/播 |
| `src/services/exportPipeline.ts` | 旧录制走原导出页 → 这条 pipeline 仍可用 |
| `src/services/cropping.ts` | 同上 |
| `src/services/audioRecorder.ts`、`src/services/cameraRecorder.ts` | 旧录制依赖 |
| `src/components/SubtitleOverlay.tsx`、`src/utils/srtParser.ts`、`src/utils/frameOverlays.ts` | 字幕 / 水印工具，新 pipeline 复用 |
| `src/app/[locale]/play/[id]/page.tsx`、`src/app/[locale]/export/[id]/page.tsx` | 旧录制点开走这里 |

### 配置 / 文档

| 文件 | 修改 |
|---|---|
| `CLAUDE.md` | 反转「禁止 getDisplayMedia」约束；增加新约束「不上传 MP4 视频 / 不做云同步」 |
| `package.json` | 加新依赖（如需）—— 当前 ffmpeg.wasm 已有，dexie 已有，基本不缺包 |

## 关键技术风险点

### R1. ffmpeg.wasm 转码速度

webm → MP4 在浏览器侧用 ffmpeg.wasm 转，30 分钟 1080p 大约 1-3 分钟。需要进度条 + 后台不阻塞 UI。已有 ffmpeg integration（exportPipeline.ts 用过），复用 API。

### R2. ffmpeg.wasm 是否带 libass（字幕滤镜）

之前 CLAUDE.md 提到「ffmpeg.wasm 没带 libass」。验证：实际上 `@ffmpeg/core` 0.12 提供两个版本——core 和 core-mt，都不带 libass。**字幕烧入要走 canvas-side**（跟现有 frameOverlays 一样，逐帧画字幕到 PNG 再编码）—— 但屏录场景下没有逐帧 PNG 的流程。

**解法**：用 ffmpeg 的 `drawtext` 滤镜（不需要 libass），按时间戳逐句 drawtext。SRT 解析后生成一个长 filter_complex。可能会很长，但能跑。

Alternative：录完字幕已存在的话，把 webm 解码出来逐帧贴字幕再重新编码——慢但通用。

#### 决策（v1）
先用 `drawtext` 路径，长 filter 复杂度可控；如果实测出问题再 fallback 到 canvas-decode-and-redraw。

### R3. 系统音频权限

`getDisplayMedia({ audio: true })` 在 Chrome 实测：
- 用户选「整个屏幕」可以拿到系统音频
- 用户选「应用窗口」拿不到
- 用户选「浏览器 tab」可以拿到该 tab 的音频
- macOS 上要求用户额外授权

需要兜底：如果用户开了 toggle 但系统没给音频 track，提示「未拿到系统音频，可能你选了应用窗口；如需录音乐请选整个屏幕或对应 tab」。

### R4. IndexedDB 容量

30 分钟 1080p VP9 ≈ 200-500MB。Chrome 默认允许磁盘 60%。对一般用户够用，但需要：
- 录制前检测剩余空间，低于 1GB 时警告
- 录制库页面显示「占用 X.X GB」
- 删除按钮要真的释放 chunks（已有，复用）

### R5. canvas.captureStream 帧率稳定性

实测 30fps 在 OffscreenCanvas + requestAnimationFrame 大致稳定，但被遮挡时浏览器可能限频（这是已知 Chrome behavior）。**这正是 CLAUDE.md 原本想避免的问题**—— 录屏架构下我们不再担心这个（因为屏幕本身被遮挡时就该录到遮挡物，这是「真实屏录」语义）。

但 cam bubble 是单独 stream，被合成进 canvas 时如果 canvas 限频，cam 也会跟着掉帧。可接受。

### R6. 旧 / 新代码路径并存的复杂度

库列表 query 两套表 + 渲染两种 kind + 点击路由分发。会让 RecordingsList 复杂一些。控制方法：
- `MergedListItem.kind` 显式区分
- 路由 helper：`router.push(kind === 'screen_capture' ? '/process/' + id : '/play/' + id)`
- 删除按钮：根据 kind 调不同 deleteRecording 函数（两套表）

## 验证（v1 怎么算 done）

### 必须通过

1. ✅ Workspace 主页有「开始录制」入口
2. ✅ 录制 setup modal 让选比例 / 音频 / 摄像头
3. ✅ 选择源走 native getDisplayMedia 弹窗，可挑 tab/window/screen
4. ✅ 非「原始」比例下，进入 RegionSelector，可拖动 / 缩放裁剪框
5. ✅ 开始录制后浮动条显示计时；可暂停 / 继续 / 停止
6. ✅ 摄像头气泡录制中可拖，位置变化反映在最终视频
7. ✅ 停止后 webm 写完，跳到 `/process/[id]`
8. ✅ 播放器能正常播 webm
9. ✅ Pro 用户点字幕生成 → DashScope → SRT 写回本地
10. ✅ Pro 用户点大纲生成 → Deepseek → markdown 写回本地
11. ✅ Free 用户下载 MP4 → 自动加水印；Pro 下载 → 无水印
12. ✅ 字幕烧入 toggle 工作
13. ✅ 旧 scene-replay 录制仍能在库列表看到，点开仍能正常播放和导出

### 应当通过

- 屏幕被其他窗口遮挡时录像录到遮挡物（确认是真录屏不是 scene-replay）
- 系统音频 toggle 开了但用户选了应用窗口 → 友好提示
- IndexedDB 写满拒绝继续录 → 友好提示
- 删除新录制释放所有 chunks（不留孤儿）
- 库列表里新旧录制按 startedAt 正确混排

### 显式不做的事（v1）

- ❌ 修剪首尾（trim start/end）—— 后续迭代
- ❌ 「导出竖屏」二次裁剪 —— 不做，让用户自己在抖音里裁
- ❌ 章节标记可视化（大纲生成了，但播放器里不嵌章节）—— 后续
- ❌ 多语种字幕 —— 沿用现有 Qwen ASR 中英文混合识别能力
- ❌ 移动端 —— Web 屏录在 Safari/iOS 限制大，不支持

## 迁移策略

### 数据
- 旧 IndexedDB 表 v1-v5 全部保留
- IndexedDB v6 新增 `screenRecordings` + `screenChunks` 表，不动旧表
- Supabase 跑一次 migration，drop `recordings_cloud` 表 + bucket（**所有云端备份会丢失**——但根据用户决策，云同步整套要废弃）

### 用户
- 已经用云同步的 Pro 用户：发邮件预告「云端备份即将下线，请在 X 月 X 日前下载到本地」（**这部分动作不在本 spec 范围**，运营自己处理；技术侧只保证旧本地录制能继续用）
- 没用过云同步的用户：无感

### 代码
- 一次大 PR，包含所有改动
- 不做 feature flag，新分支直接顶替

## 不变的产品级约束（更新版）

把现有 CLAUDE.md 的「禁止事项」改为：

- ❌ ~~不用 `getDisplayMedia()`~~ → **新架构以此为核心，此约束反转**
- ❌ **不上传任何视频 / 音频 / 录制源到服务器**（除字幕生成阶段的临时音频上传，处理完即释放）
- ❌ 不引入云端备份 / 跨浏览器同步
- ❌ 不引入录制时长上限
- ❌ 字幕仍统一阿里千问，禁 Whisper
- ❌ Pro 用户购买后，对**任何历史录制**重下都应是 clean（即水印 / 字幕在下载阶段决定）
- ❌ 旧 scene-replay 录制保持「唯读可回放」，新代码不要进行 scene-replay 路径的任何修改 / 扩展
