# PRD：白板录制工具
**版本**：v0.6.5  
**状态**：开发中  
**作者**：—  
**最后更新**：2026-06-08  
**变更**：v0.6.5 - 导出页按 `editor.jsx` 1:1 重做为编辑器（顶栏可改名 + Share/Export · 左播放器 + 时间轴 · 右按 tier 分级 Tab）+ 功能性时间轴裁剪（单 in/out 段，`recording.segments`，导出按段裁剪、ffmpeg `-ss` 对齐音频/摄像头/字幕）。详见「## 十一」最新一条。  
**历史变更**：v0.6.4 - 关键用户事件落库 Supabase（`analytics_events` + `/api/analytics` + 统一 `trackEvent` 双写）；后台分析 Dashboard `/admin/analytics`（漏斗/时序/排行，ADMIN_SECRET 鉴权）；Library 页 1:1 重做（搜索 + 筛选 + 排序 + grid/list 视图切换）。详见「## 十一」最新一条。  
**历史变更**：v0.6.3 - 修 Excalidraw unpkg CDN ChunkLoadError（自托管资源）；裁切框升级为可拖拽移动 + 四角缩放（预设锁比例 / 自定义自由框选 + 框旁 W×H 实时联动），导出按框定区域输出；选定裁切框后摄像头限框内移动。详见「## 十一」。  
**历史变更**：v0.6.2 - 设计重构 Phase 2：录制前 Setup 面板（比例分组 + 摄像头配置 + 麦克风 + 含工作区开关 + 3 秒倒计时）+ 比例集扩到 10 预设 + 配置随录制持久化 + 画布裁切框 viewfinder + 导出默认沿用。详见「## 十一」。  
**历史变更**：v0.6.1 - 会员年付价格全链路（`payment_config` 加 4 列年价/年付 product id、`/api/checkout/pro` 加 `billing`、升级弹窗/定价页月年切换、admin 校验扩展到年付槽位、Supabase 迁移）+ 定价页去除团队席位收费内容。详见「## 十一」。  
**历史变更**：v0.6 - 新增 SEO / GEO / 内容营销基建（「## 十二」）：技术 SEO 地基（sitemap/robots/OpenGraph/hreflang/Analytics）、GEO（JSON-LD `SoftwareApplication`/`FAQPage`/`Article` + `llms.txt` + 放行 AI 爬虫）、程序化内容引擎（`/compare`·`/use-cases`·`/blog` 数据驱动长尾着陆页）+ 零预算冷启动手册 `docs/marketing-cold-start.md`。详见「## 十一」最新一条与「## 十二」。  
**历史变更**：v0.5.2 - 定价页四档权益补全（校准「全档不限时长」、支付商按 active provider 动态显示=Creem）；面向用户文案去掉 `Deepseek`/`AI` 字样；应用内 logo 点击回落地页；摄像头气泡可缩放（前端 80–480）；修 `past_due` 宽限期被误降级为 free。详见「## 十一」最新一条。  
**历史变更**：v0.5.1 - 支付成功后回到发起页（导出页透传 `returnTo`，新标签不再落到 `/app`）；登录邮件品牌化（Excalicast 邮件模板 + 自定义 SMTP 配置/手册）。  
**历史变更**：v0.5 - 新增「## 十一、实现进展与变更记录（持续同步）」，沉淀已落地实现（定价四档 + Max 可购买、素材库云同步/市场、分享链接、AI 讲义、激光笔、品牌标识等）与第四轮迭代（讲义智能配图/多格式导出、录制与导出性能、分享加载与移动端自适应、字幕清洗单行）。本 PRD 自此为产品需求唯一来源，新增内容须同步更新（见 CLAUDE.md「PRD 同步要求」）。  
**历史**：v0.4 - 录制方案锁定 B（事件流重放）；单次购买改为 paid_recordings 表（去令牌）；所有外部 LLM/Whisper 调用必须经服务端 BFF；所有层级录制时长无上限；支付服务统一 Creem；新增数据生命周期 / 合规告知 / 退款政策 / 录制恢复 / 分享链接管理 / PoC 清单六个章节

---

## 一、背景与目标

### 1.1 背景

本产品的白板内核是基于开源项目二次开发的，一款开源的在线白板工具，拥有庞大的用户社区，广泛应用于架构设计、教学讲解、产品需求传递等场景。其核心优势是"画图快、协作轻"，但存在一个根本性缺陷：**画板是静态的，无法传递"思考过程"**。

现有解法（Loom 录屏 + Whisper 字幕）可以解决"录制"问题，但 AI 只能理解像素流，无法理解画板语义，导致后处理质量低下，尤其是讲义生成。

### 1.2 产品定位

> **"录一次，得到四份资产。"**
> 录制 → 自动生成：可回放画板 + 可导出视频 + 字幕文件 + 结构化讲义

本产品以 独立 Web 应用（基于开源白板内核二次开发）形式存在，核心价值主张是：**把创作过程变成可传播的知识资产**。

### 1.3 核心目标（v0.1）

| 目标 | 衡量指标 |
|------|---------|
| 用户能完成一次录制并导出 | 录制完成率 > 80% |
| AI 生成字幕质量可用 | 字幕准确率 > 90%（WER < 10%） |
| 讲义结构化程度 | 讲义包含标题层级 + 图元引用 |
| 导出成功率 | MP4 / PDF 导出成功率 > 95% |
| 商业化验证 | 免费→付费转化率 > 5%（含单次购买）|

---

## 二、目标用户

### 主要用户群

**A. 技术讲师 / 培训师**
- 核心场景：用白板讲解技术原理、架构方案，录制后发给学员
- 核心诉求：讲完就有讲义，不用再整理笔记
- 付费意愿：高（节省备课时间）

**B. 产品经理**
- 核心场景：录制需求讲解替代文字 PRD，发给开发/设计
- 核心诉求：表达清晰，减少对齐成本
- 付费意愿：中（效率工具）

**C. 技术负责人 / 架构师**
- 核心场景：录制架构 walkthrough，异步评审
- 核心诉求：决策过程可追溯，留存归档
- 付费意愿：高（团队协作场景）

### 次要用户群

- 咨询顾问（客户演示录制）
- 知识博主（内容创作）

---

## 三、核心功能范围（v0.1 MVP）

### 功能优先级

```
P0（必须做）：录制 · 画幅比例 · 导出
P1（应该做）：字幕 · 人像窗口
P2（计划做）：讲义
```

### v0.4 整体技术约束（贯穿所有功能）

1. **录制方案锁定 B**：录制阶段只采集事件流 + binaryFiles + 音频，画面渲染只在导出阶段发生。废弃所有"实时帧抓取"思路。
2. **binaryFiles 是 Day-1 schema**：用户嵌入图片 / 自定义字体的二进制数据必须在录制时同步抓到 IndexedDB，否则导出/分享回放时会渲染失败。
3. **白板内核版本锁死**：`recordingMetadata.kernelVersion` 字段必须在录制时写入；每次内核升级前必须用样本录制做视觉回归测试，pixel-diff 通过才合并。
4. **导出默认 15fps**：白板讲解场景 15fps 视觉无差，渲染量减半。30fps 仅作为高级选项。
5. **API Key 严禁前端持有**：所有外部 LLM / Whisper / Deepseek 调用必须经服务端 BFF 代理。

---

### F1：录制（P0）

#### 功能描述

在白板 界面内嵌录制控制栏，同步采集：
- **操作事件流**：每个画板操作（新增元素、移动、修改属性）打上时间戳，序列化为 JSON
- **麦克风音频**：WebAudio API 采集，实时编码为 Opus/WebM

#### 关键交互

| 状态 | 触发 | 表现 |
|------|------|------|
| 待录制 | 进入工具 | 顶部显示录制按钮 |
| 录制中 | 点击开始 | 红点 + 计时器，画板操作正常可用 |
| 已暂停 | 点击暂停 | 计时器停止，音频停采 |
| 已结束 | 点击停止 | 进入后处理流程 |

#### 技术要点

- 操作事件 Hook 白板的 `onChange` 回调，每次变更记录 `{ timestamp, type, elements_delta }`
- 音频通过 `MediaRecorder API` 采集，chunk 缓存至 IndexedDB（防页面刷新丢失）
- 最终打包格式：`{ metadata, events[], audio_blob }` → 本地存储或上传

#### 录制隔离机制（关键架构决策）

**本产品采用「事件流重放」方案：录制阶段只采集操作事件 + 音频，画面渲染发生在导出阶段，由离屏 Canvas 按事件流重新生成。**

```
❌ 屏幕录制方案（OBS / getDisplayMedia）：
   捕获屏幕像素 → 其他窗口遮挡时录到遮挡物 → 最小化或切换应用时录制中断

❌ 实时帧抓取方案（每帧 canvas.toDataURL()）：
   依赖 requestAnimationFrame，浏览器后台时降至 1Hz → 录制丢帧

✅ 本产品方案（事件流重放）：
   录制阶段：仅采集 onChange 事件 + binaryFiles + 音频（CPU 占用极低）
   导出阶段：离屏 Canvas 按事件流逐帧重渲染 → 编码为 MP4
   → 录制阶段不依赖渲染，浏览器最小化 / 锁屏 / 标签页切换均不影响录制结果
   → 渲染发生在用户主动导出时，可重复以任意分辨率/帧率/比例重新生成
```

**禁止**：任何情况下不得使用 `navigator.mediaDevices.getDisplayMedia()` 来采集画板内容，否则上述隔离保证全部失效。

#### 录制方案的产品边界（用户须知）

- 拖动 / 缩放 / 路径绘制等连续动作，事件流只记录关键节点（白板 onChange 触发频率有限），回放时可能呈现"分段插值"而非原始手感连续动作。教学场景下视觉影响极小。
- 嵌入的远程图片 / 网页内容必须在录制时由前端主动 fetch 并缓存到 IndexedDB binaryFiles，否则导出时无法重建。

#### 边界条件

- 标签页切换时：音频继续采集，事件流继续采集（白板 onChange 不依赖渲染），实时预览可能冻结但**录制结果不受影响**
- 无麦克风权限：仅录操作序列，不录音频，提示用户
- 浏览器最小化时：音频继续采集，事件流继续采集，实时预览冻结但**录制结果不受影响**
- 系统锁屏时：操作系统节能策略可能挂起浏览器进程，**麦克风采集会停止**（OS 限制，非产品缺陷），事件流采集恢复后续接
- 浏览器崩溃/刷新：IndexedDB 已持久化的 chunk 不丢失，重启后提示恢复（详见 §十二 录制恢复流程）

---

### F1.2：画幅比例（P0）

#### 功能描述

录制前允许用户选择画布的输出比例，决定最终视频的宽高比和 白板画板的渲染裁切区域。

#### 支持的比例

UI 分组展示（横屏 / 竖屏 / 方形 / 自定义），默认展开横屏组，卡片悬停时显示平台图标。

---

**横屏**

| 比例 | 分辨率 | 主要适用平台 & 场景 |
|------|--------|-------------------|
| **16:9**（默认） | 1920×1080 | **YouTube** 标准投稿 · **B 站**主流横屏投稿 · **微信视频号**横屏 · 腾讯会议/Zoom 录制分享 · PC 端网页播放 · 企业内部培训视频 |
| **4:3** | 1440×1080 | **学堂在线/网易云课堂**等传统培训平台 · **PowerPoint/Keynote 4:3 模板**嵌入 · 钉钉直播横屏 |
| **21:9** | 2560×1080 | **LG UltraWide / Samsung Odyssey** 超宽屏用户全屏展示 · 沉浸式技术演示 · 电影感课程封面 |
| **16:10** | 1920×1200 | **MacBook Pro / MacBook Air** 原生屏幕全屏无黑边 · **iPad Air / iPad Pro（10.9"/11"）横屏** |
| **3:2** | 1620×1080 | **Microsoft Surface Pro / Surface Laptop** 原生比例 · 与**佳能 EOS R5/R6/R3、Sony A7 IV/A7R V、尼康 Z8/Z9、富士 X-T5/X-H2** 等全画幅无反相机直出 RAW 同规格混剪 |

---

**竖屏**

| 比例 | 分辨率 | 主要适用平台 & 场景 |
|------|--------|-------------------|
| **9:16** | 1080×1920 | **抖音**（Feed 流标准全屏格式）· **TikTok** · **微信视频号**竖屏 Feed · **快手** · **YouTube Shorts** · **Instagram Reels / Stories** · **B 站竖屏 Story 模式** · 微博故事 |
| **4:5** | 1080×1350 | **Instagram 正文 Feed 竖图**（官方最大竖向比例，不被裁切）· **Facebook 竖版视频** |
| **3:4** | 1080×1440 | **小红书图文笔记**（Feed 流展示面积最优、截断最少）· **微博竖版视频** · iPad 竖屏（9.7"/10.2"） |
| **2:3** | 1080×1620 | **小红书封面图**（搜索结果流竖向占位最大）· **Pinterest** 竖图 · 海报/印刷品导出 |

---

**方形**

| 比例 | 分辨率 | 主要适用平台 & 场景 |
|------|--------|-------------------|
| **1:1** | 1080×1080 | **Instagram 方形 Feed**（经典格式）· **微博**方图 · **小红书**方形笔记封面 · **微信朋友圈**（方图不裁切）· 头像 / 封面制作 |

---

**自定义**：输入宽 × 高（像素），范围 360~3840px，输入后实时显示换算比例（如 1280×960 → "约 4:3"）。

#### 关键交互

- 比例选择器在**录制开始前**的设置面板展示，按"横屏 / 竖屏 / 方形 / 自定义"分组
- 选择后，白板画板外围出现对应比例的**裁切框预览**（半透明蒙层），画板内容仍可自由延伸，超出框外不录入视频
- 裁切框可拖拽移动，锁定录制区域
- 录制中不可修改比例

#### 技术实现

```
渲染时：
  1. 按选定比例计算离屏 Canvas 尺寸
  2. 将 白板的 scene 坐标系映射到该 Canvas（裁切框区域 → 全帧）
  3. 裁切框以外的区域渲染为纯色背景（默认白色，可选深色/自定义色）
```

#### 边界条件

- 切换比例时：裁切框位置重置到画板中心可见区域
- 9:16 / 2:3 等高竖屏时：白板画板区域自动纵向压缩，工具栏吸附到左侧
- 自定义比例：宽高均不低于 480px，不超过 4096px
- 导出 MP4 时：按选定比例严格渲染，不做黑边填充

---

### F1.3：人像窗口（P1）

#### 功能描述

录制时开启摄像头，将讲解者的面部画面以浮窗形式叠加在画板视频上，最终合成进导出的 MP4。类似 Loom 的脸部气泡，增加讲解的临场感和信任度。

#### 功能细节

**开关与权限**
- 默认关闭，录制前在设置面板手动开启
- 开启时浏览器请求摄像头权限（独立于麦克风权限）
- 无摄像头设备或拒绝权限：功能不可用，静默降级，不影响其他录制功能

**窗口样式**

| 属性 | 交互方式 | 范围 / 选项 | 默认值 |
|------|---------|-----------|--------|
| 形状 | 切换按钮 | 圆形 / 圆角矩形 | 圆形 |
| **尺寸** | **滑动条** | **80px ～ 480px（步长 1px，实时预览）** | **200px** |
| 位置 | 四角快捷按钮 + 自由拖拽 | 任意位置 | 右下角 |
| 背景去除 | 开关 | 开 / 关 | 关 |

**尺寸滑动条交互细节**
- 滑动条拖动时，浮窗实时缩放（无需松手确认）
- 滑动条两端标注参考值：左端"小"（80px）、右端"大"（480px），中间无刻度
- 支持键盘方向键微调（每次 ±4px）
- 录制中也可调整尺寸，调整事件记录进 `cameraEvents`（含 size 字段）

**录制中交互**
- 人像窗口可在录制中实时拖拽移动，位置变化记录进事件流
- 双击人像窗口：临时隐藏（继续录像但不显示），再次双击恢复
- 隐藏状态下导出：对应时段视频中无人像窗口

**视频合成**
- 导出 MP4 时，人像视频流作为独立图层叠加在画板视频之上
- 合成层级：画板视频（底层）→ 人像窗口（顶层）→ 字幕（最顶层）

#### 技术实现

```typescript
// 摄像头采集
const cameraStream = await navigator.mediaDevices.getUserMedia({
  video: { width: 640, height: 640, facingMode: 'user' }
});

// 实时预览：将 cameraStream 渲染到悬浮 <video> 元素（裁剪为圆形用 border-radius）
// 录制：用独立 MediaRecorder 录制摄像头流，存储为 camera_blob
// 合成：ffmpeg.wasm 中将 camera_blob 作为 overlay 滤镜叠加

// ffmpeg overlay 命令示意：
// [0:v][1:v] overlay=W-w-20:H-h-20 [out]
// （画板视频 + 摄像头视频，右下角定位）
```

**背景分割（可选增强）**
- 使用 `@mediapipe/selfie_segmentation` 实时抠出人像，背景模糊化
- 性能消耗较高（GPU 加速），作为可选项，低配设备自动禁用

#### 摄像头权限拒绝处理

- 用户在设置面板勾选了「开启人像窗口」但权限被拒绝时：弹出非阻塞 toast「摄像头权限被拒，人像窗口已自动关闭，可在浏览器设置中重新授权」，并把开关回拨到关闭。**不静默降级**，避免用户误以为已开启。
- 录制中摄像头断开：toast「人像窗口已停止」，cameraEvents 追加 `hidden=true` 事件，导出阶段从断开点起不再叠加。

#### 背景去除的范围限制

- v0.1 阶段背景去除（mediapipe selfie_segmentation）**仅作用于录制时的实时预览**，最终导出 MP4 时摄像头视频按原图叠加（不带去背景）。
- 原因：导出阶段做实时分割需要把每帧从 mediapipe 跑一次再交给 ffmpeg，性能开销极高，与"本地 5 分钟内出片"的目标冲突。
- v0.2 评估：是否在录制阶段就用分割后的流编码进 cameraBlob（录制流即去背景流）。

#### v0.1 摄像头窗口的简化约束

- 录制中**不可拖动**人像窗口位置，仅可在 setup 面板里选定四角位置后录制。原因：ffmpeg.wasm 处理动态分段 overlay 性能不可控，且分段越多 filter 字符串越长。
- 录制中**可双击**临时隐藏 / 显示（这是布尔切换，filter 实现简单）。
- 录制中**可拖动尺寸**（滑动条），但 v0.1 仅取**录制结束时的最终尺寸**作为整段视频的人像窗口尺寸（简化合成）。
- 「全程动态位置 + 动态尺寸」作为 v0.2 优化项。

#### 边界条件

- 仅有摄像头无麦克风：画面有人像但视频无声音（应提示用户）
- 9:16 竖屏模式下：人像窗口默认位置调整到右上角（避免与操作区重叠）
- 尺寸调整至极小（< 80px）或极大（> 480px）时自动吸附到边界值

---

### F1.4：录制隔离（P0）

#### 功能描述

录制**结果**完全不受其他应用窗口的干扰。无论用户切换软件、有弹窗遮挡、浏览器最小化或锁屏，录制产物始终是白板画板本身的内容（事件流 + binaryFiles + 音频），不会受屏幕显示状态影响。

#### 为什么能做到

这是本产品相比传统录屏工具（OBS / Loom / 系统录屏）的**根本性架构优势**：

```
传统录屏：              本产品：
录制时抓屏幕像素         录制时只采集事件流 + 音频
    ↓                        ↓
其他窗口覆盖             浏览器后台 / 最小化
= 录到覆盖物              = 事件继续采集（onChange 不依赖渲染）
                          = 音频继续采集（除非系统级挂起进程）
                          ↓
                          导出时离屏 Canvas 按事件流重渲染
                          = 任何外部环境状态都已与录制结果脱钩
```

录制阶段的产物是**事件流 + binaryFiles + 音频**——这些都不依赖任何屏幕渲染。视频画面只在用户**主动点导出**时由 OffscreenCanvas 重新生成。

#### 具体表现

| 场景 | 传统录屏 | 本产品 |
|------|--------|--------|
| 其他窗口覆盖画板 | 录到覆盖窗口 | 完全不影响 |
| 切换到其他标签页 | 录到标签页内容 | 完全不影响（事件流和音频继续采集） |
| 系统通知弹窗 | 录到通知 | 完全不影响 |
| 浏览器最小化 | 录到桌面 | 完全不影响（实时预览可能冻结，但不影响录制结果） |
| 系统锁屏 | 录黑屏 | 事件流不受影响；麦克风可能因 OS 节能策略被挂起，恢复后续接 |

#### 实时预览 vs 录制结果（UI 文案必须区分）

- **实时预览**：用户在录制中看到的画板视图，依赖浏览器主线程渲染。最小化 / 切标签页期间会冻结，恢复后正常。
- **录制结果**：导出时按事件流重新渲染的视频。**不受**任何前台 / 后台状态影响。
- UI 必须用清晰文案告知用户："预览冻结 ≠ 录制中断"，避免用户误判。

#### 技术实现

```typescript
// 渲染不依赖可见 DOM，使用 OffscreenCanvas
const offscreen = new OffscreenCanvas(videoWidth, videoHeight);
const ctx = offscreen.getContext('2d');

// 仅在导出阶段按事件流逐帧重绘
// 整个渲染管线与屏幕显示完全解耦
```

> **这个特性是方案 B（事件流重放）的内在属性，不需要额外开发**。需要在产品文案和竞品对比中主动突出这个优势。

---

### F2：导出（P0）

#### 功能描述

录制结束后支持三种导出格式：

| 格式 | 内容                    | 适用场景 |
|------|-----------------------|---------|
| **MP4** | 画板操作回放 + 音频 + 人像合成为视频 | 发给微信、上传 B 站 |
| **操作序列包（.excr）** | JSON 事件流 + 音频文件       | 在播放器中交互式回放 |
| **PNG/SVG 快照** | 录制结束时的画板静态图           | 插入文档、分享 |

#### MP4 生成方案

- 前端方案：使用 `ffmpeg.wasm` 在浏览器端合成（无需上传）
- 流程：按事件流逐帧渲染 Canvas → 编码为 H.264 → 混入音频轨道
- 预计耗时：10 分钟录制约需 2-5 分钟本地渲染
- 进度条实时反馈，支持后台处理

#### 边界条件

- 导出 MP4 分辨率默认 1080p，按画幅比例决定宽高（见 F1.2）
- 无音频录制时：导出静音视频
- 人像窗口位置：合成时按录制中的实时位置记录还原（支持动态位移）
- 文件大小预估：10 分钟 ≈ 100-300 MB（含人像窗口时略增）

---

### F3：字幕（P1）

#### 功能描述

基于录制音频，自动生成时间轴字幕，并与操作事件流对齐。

#### 处理流程

```
音频 → Whisper API（或本地模型）→ SRT 字幕 → 与操作序列时间戳对齐 → 嵌入导出
```

#### 输出形式

- **SRT 文件**：可单独下载，可嵌入 MP4 软字幕
- **画板叠加字幕**：在 Web 播放器中，字幕实时叠加在画板下方
- **全文文稿**：去除时间戳的纯文字，作为讲义原材料

#### 字幕质量策略

- 默认使用 Whisper small，识别准确率 > 90%
- 支持手动编辑字幕（点击文字直接修改）
- 语言自动检测，支持中/英/西班牙语

#### 边界条件

- 无音频时：字幕功能不可用，灰态展示
- 网络不可用时：提示用户下载本地 Whisper 模型（可选）

---

### F4：讲义（P2）

#### 功能描述

结合操作事件流（画板语义）+ 音频转录文字，由 AI 生成结构化讲义文档。

#### 讲义生成逻辑

```
输入：
  - 操作事件流（知道画了什么：节点名称、连接关系、标注文字）
  - 全文文稿（知道说了什么）

处理：
  - AI 识别话题边界（结合语义 + 操作密度）→ 生成章节
  - 每章节：标题 + 摘要 + 对应画板截图（关键帧）+ 相关文字

输出：
  - Markdown 文档（可导出 PDF / Word）
  - 结构：封面 → 目录 → 各章节 → 附录（元素索引）
```

#### 讲义结构示例

```markdown
# 微服务架构设计讲解
## 第一章：整体架构概览（00:00 - 03:20）
[画板截图：t=180s]
本章介绍了系统由三个核心服务组成：用户服务、订单服务、支付服务...

## 第二章：用户服务详解（03:20 - 08:45）
[画板截图：t=350s]
用户服务负责认证与授权，通过 JWT 与下游服务通信...
```

#### 边界条件

- 无字幕（无音频）时：仅基于画板操作生成结构，内容较少
- 讲义生成耗时约 30-60 秒，异步处理，完成后通知用户
- 支持用户手动调整章节分割点

---

## 四、不在范围内（v0.1 MVP）

| 功能 | 原因 |
|------|------|
| 云端视频文件存储 | Max 分享链接存储的是事件流+音频（<120MB），不是 MP4 视频文件；视频仍为本地导出 |
| 多人协同录制 | 复杂度高，MVP 单人场景 |
| 观众端 AI 提问 | 依赖讲义质量，二期功能 |
| 移动端适配 | 录制场景以 PC 为主 |
| 视频编辑（剪辑） | MVP 不做 |
| 支付系统集成（Stripe / 微信支付 / 支付宝） | MVP 阶段先手动发码验证付费意愿，M8 再接入 |

---

## 四点五、付费模型

### 层级定义

| 层级 | 需要登录 | 价格（参考） | 核心权益 |
|------|:------:|------------|---------|
| **免费** | ❌ | $0 | 录制 · 导出 MP4（**带水印**）· 本地回放 |
| **单次购买** | ❌ | ~$2~5 / 次 | **即买即走**，无需注册账号 · 导出 MP4（**无水印**）· 录制数据全程留在本地 |
| **Pro**（订阅） | ✅ | ~$12 / 月 | 无水印导出 + **字幕**（SRT + 嵌入）+ 录制无时长上限 + 云端备份 |
| **Max**（订阅） | ✅ | ~$25 / 月 | Pro 全部权益 + **AI 讲义**（Markdown/PDF）+ **分享链接** |

---

### 各层级功能矩阵

| 功能 | 免费 | 单次购买 |     Pro     | Max |
|------|:---:|:-------:|:-----------:|:---:|
| **需要登录** | ❌ | ❌ |      ✅      | ✅ |
| **数据上传服务器** | ❌ | ❌ | 音频（Whisper） | 事件流+音频（分享） |
| 录制（操作序列 + 音频） | ✅ | ✅ |      ✅      | ✅ |
| 画幅比例选择 | ✅ | ✅ |      ✅      | ✅ |
| 人像窗口 | ✅ | ✅ |      ✅      | ✅ |
| Web 回放（本地） | ✅ | ✅ |      ✅      | ✅ |
| 导出 PNG/SVG 快照 | ✅ | ✅ |      ✅      | ✅ |
| 导出 MP4（含水印） | ✅ | — |      —      | — |
| 导出 MP4（无水印） | ❌ | ✅ |      ✅      | ✅ |
| 字幕生成（Whisper） | ❌ | ❌ |      ✅      | ✅ |
| SRT 文件下载 | ❌ | ❌ |      ✅      | ✅ |
| 字幕嵌入 MP4 | ❌ | ❌ |      ✅      | ✅ |
| 云端备份（防丢失） | ❌ | ❌ |      ✅      | ✅ |
| AI 讲义生成 | ❌ | ❌ |      ❌      | ✅ |
| 讲义导出（MD/PDF） | ❌ | ❌ |      ❌      | ✅ |
| 分享链接（云端托管） | ❌ | ❌ |      ❌      | ✅ |

---

### 关键设计决策说明

**① 单次购买：匿名支付 + 本地渲染 + paid_recordings 表（去令牌设计）**

单次购买的核心设计原则：**服务端只管钱，不碰录制数据**。

> 关于支付服务：本项目使用 **Creem**（面向出海 SaaS 的轻量支付服务，无需用户注册即可完成卡支付，支持 webhook + Checkout metadata）。

```
用户点击「去除水印」
    ↓
客户端把 recordingId（IndexedDB 内的本地 UUID）写入 Creem Checkout 的 metadata.recordingId
跳转 Creem 支付页（无需注册账号，填邮箱 + 卡号即可）
    ↓
用户支付成功
    ↓
Creem webhook 命中服务端：
  - 验证 webhook 签名（Creem 标准）
  - 读 metadata.recordingId
  - INSERT INTO paid_recordings (recording_id, paid_at, amount, creem_session_id)
    ↓
客户端导出 MP4 时：
  - 调用 POST /api/is-paid { recordingId } → 服务端 SELECT → 返回 true/false
  - true：ffmpeg.wasm 跳过水印图层，输出无水印 MP4
  - false：渲染含水印版本（用户尚未支付或支付失败）
    ↓
录制数据（事件流 + binaryFiles + 音频）全程存在客户端 IndexedDB，从未上传
```

**为什么不用 JWT 令牌**：
- 客户端是渲染方，任何客户端检查都可被 patch 代码绕过；JWT 的「一次性销毁」机制提供的安全收益有限，复杂度却很高（Redis 存 jti、签发逻辑、过期时间管理、UA/IP 绑定都是无效防御）
- paid_recordings 表是无状态的「按 recordingId 查询付费」服务端查询，简单且足够

**新方案的天然优势**：
- 付一次 = 这条 recording 永久无水印，用户可反复尝试不同分辨率 / 帧率 / 比例的导出，不再敌对体验
- 用户换设备：把 IndexedDB 数据导出（.excr 包）再导入即可继续无水印导出
- 服务端代码量约 30 行（webhook 处理 + is-paid 接口），运维负担极低

**滥用边界**：
- 恶意用户拿到他人 recordingId 也无用（没有对应的录制数据）
- 客户端 patch 代码绕过水印检查在理论上可能，但水印是品牌曝光属性，不是绝对 IP 保护——接受少量绕过

**② 水印的实现方式**

水印在客户端 ffmpeg.wasm 合成阶段叠加，服务端从不接触录制数据：

```
免费导出（纯本地，无网络请求）：
  事件流 + binaryFiles + 音频 → ffmpeg.wasm 渲染 → 叠加水印图层 → 输出 MP4

单次购买导出（仅 is-paid 查询走网络）：
  用户支付 → 服务端 paid_recordings 表已记录该 recordingId
  → 调用 /api/is-paid（只传 recordingId，不传录制数据）
  → 返回 true → ffmpeg.wasm 本地渲染（跳过水印图层）→ 输出 MP4

Pro/Max 导出（订阅状态验证）：
  → 调用 /api/check-subscription（只传用户 token）
  → 验证通过 → ffmpeg.wasm 本地渲染（跳过水印图层）→ 输出 MP4
```

水印规格：
- 位置：右下角，距边缘 20px
- 内容：产品 Logo + 域名
- 透明度：60%，不完全遮挡内容但清晰可见
- 叠加在画面内容区（非纯黑边），不可通过简单裁切去除

**③ 分享链接（Max 专属）的存储策略——只存操作流 + 音频 + binaryFiles，不存视频**

**核心决策**：Max 分享功能**永远不上传、不存储 MP4 视频文件**。云端存储事件流 + binaryFiles + 音频，视频由访问端的 Web 播放器实时重建。原因：

- 操作事件流 + binaryFiles + 内核版本号合在一起足以重建画板状态——比 MP4 更小且支持 AI 讲义二次加工
- MP4 存储成本是事件流方案的 5-10 倍（带图录制），且无额外语义价值
- 分享场景（发给同事/学员/客户）在浏览器里看已经完全满足需求

```
用户触发分享
    ↓
上传：事件流 + binaryFiles + 音频 + kernelVersion → OSS/S3
    ↓
生成短链（如 [产品域名]/s/abc123）
    ↓
链接 TTL：默认 30 天（Max 用户可手动续期或永久保留，详见 §十三 分享链接管理）
    ↓
收件方访问：
    浏览器加载 Web 播放器（按 kernelVersion 加载对应版本白板内核）
    → 拉取事件流 + binaryFiles + 音频
    → 客户端实时重渲染白板（无需服务器渲染视频）
    → 可选：点击「导出 MP4」在本地渲染下载（耗时在收件方本地，不消耗服务器）
```

**这个方案的限制**：
1. 收件方无法直接在微信 / 抖音 / B 站等平台直接播放（这些平台需要 MP4 视频 URL）。解决方式：分享页提供"**在此页播放**"（主路径）+ "**导出 MP4 到本地**"（再发布路径）两个选项。
2. 录制时如嵌入了远程图片，前端必须主动 fetch 并转 dataURL 持久化进 binaryFiles，否则收件方无法看到图片。

存储成本估算（单用户 Max，月均 10 次录制，Opus 32kbps，每次录制平均 2 张嵌入图）：
- 事件流：~5MB × 10 = 50MB/月
- binaryFiles：~3MB/张 × 2 张 × 10 次 = 60MB/月
- 音频（优化后）：~7MB × 10 = 70MB/月
- S3 总计：~180MB × $0.023 = **$0.004/月/用户**
- 重度用户（每次录制嵌 10 张高清图）成本上升至 ~$0.02/月/用户，仍在合理区间
- 防止失控：单用户云端存储上限 5GB，超额自动删除最旧录制并通知用户

**④ 为什么字幕不在单次购买里 + Pro 字幕配额**

字幕需要调用 Whisper API（约 $0.006/分钟），30 分钟 = $0.18/次。单次购买定价约 $2~5，若包含字幕则每次成本侵蚀利润过多。字幕作为订阅层（Pro）的核心差异化，驱动用户从单次购买升级到月订阅。

**Pro 字幕月度配额**（必须在用户下单前明示）：
- 每月 **300 分钟**字幕额度（约支撑 10 次 30 分钟录制）
- 超额后字幕功能本月停用，下月 1 日重置；用户可临时按 $0.05/分钟 加购，或升级 Max（同样 300 分钟）
- 服务端在 BFF 代理层强制执行配额，不依赖客户端控制
- Whisper 单次调用费 $0.006/分钟，300 分钟成本 $1.8 ≈ Pro 月费的 15%，留出 Max 讲义生成 + 分享存储的成本余量

**⑤ 升级引导触发点**

| 用户行为 | 触发引导 | 推荐升级层级 |
|---------|---------|------------|
| 录制完成，点击导出 | 导出预览页显示水印预览 + 去除水印按钮 | 单次购买 或 Pro |
| 导出完成，点击生成字幕 | 功能锁定提示 | Pro |
| 字幕生成后，点击生成讲义 | 功能锁定提示 | Max |
| 试图分享给他人 | 功能锁定提示 | Max |

引导原则：**非打断式**。用户正在录制时不弹升级弹窗，只在自然操作节点（导出、生成字幕等）触发引导。

---

```
1. 用户打开工具（白板录制工具）—— 无需登录，直接使用
2. 录制前设置：
   ├── 选择画幅比例（16:9 / 9:16 / 1:1 / 4:3 等）
   ├── 开启人像窗口（可选，请求摄像头权限）
   └── 确认麦克风（请求麦克风权限）
3. 画板出现裁切框预览 + 人像气泡预览
4. 点击「开始录制」
5. 用户在画板上画图 + 语音讲解（可拖动人像窗口位置）
6. 点击「停止录制」→ 进入导出页
7. 导出页（按层级分叉）：

   ┌─ 所有用户（无需登录）──────────────────────────────┐
   │  Web 回放预览（本地，无网络）                        │
   │  导出 PNG/SVG 快照                                  │
   │  导出 MP4（含水印）—— 直接本地渲染下载               │
   └─────────────────────────────────────────────────────┘

   ┌─ 单次购买（无需登录，即买即走）────────────────────┐
   │  点击「去除水印」→ 客户端把 recordingId 写入        │
   │  Creem Checkout metadata → 跳转 Creem 支付（填卡号）│
   │  支付成功 → Creem webhook → 服务端 paid_recordings │
   │  表记录该 recordingId                               │
   │  → 客户端调 /api/is-paid 验证 → ffmpeg.wasm 本地渲染│
   │  → 输出无水印 MP4，录制数据全程留在本地             │
   │  → 同 recordingId 后续可反复无水印导出（不限次数） │
   └─────────────────────────────────────────────────────┘

   ┌─ Pro / Max（需要登录）──────────────────────────────┐
   │  导出 MP4（无水印）                                  │
   │  [Pro] 生成字幕（音频经 BFF 转发 Whisper API）       │
   │    ├── SRT 文件下载                                  │
   │    └── 字幕嵌入 MP4                                 │
   │  [Max] AI 讲义生成（事件流 + 字幕 → BFF → Deepseek）│
   │  [Max] 生成分享链接（事件流+binaryFiles+音频→OSS）  │
   └─────────────────────────────────────────────────────┘

8. 登录触发点（非打断式，仅在以下操作时出现）：
   - 点击生成字幕 → 提示登录并订阅 Pro
   - 点击生成讲义 → 提示登录并订阅 Max
   - 点击分享链接 → 提示登录并订阅 Max
```

---

## 六、非功能性需求

| 类别 | 要求 |
|------|------|
| 性能 | 录制期间 CPU 占用 < 15%，不影响画板流畅度 |
| 数据安全 | 免费 / 单次购买：音频 + 操作数据仅存本地 IndexedDB，不上传服务器；Pro：音频在调用 Whisper 时临时上传，处理后删除；Max 分享：事件流 + 音频上传至 OSS，TTL 30 天后自动删除 |
| 浏览器兼容 | Chrome 110+，Edge 110+（依赖 MediaRecorder + ffmpeg.wasm） |
| 隐私 | 明确告知用户麦克风使用目的；Max 分享链接上传前需二次确认"内容将上传至服务器" |
| 离线能力 | 录制 + 操作序列存储 + MP4 导出：可完全离线；字幕 / 讲义 / 分享链接：需网络 |
| 防滥用 | 单次购买 Token 一次性使用，绑定 session ID，不可复用；Max 分享链接不可枚举（使用随机 UUID） |

---

## 七、成功指标

**产品指标**

| 指标 | 目标值 | 衡量周期 |
|------|--------|---------|
| 录制完成率 | > 80% | 周 |
| 导出成功率（MP4） | > 95% | 周 |
| 字幕满意度（用户评分） | > 4/5 | 月 |
| 讲义生成后下载率 | > 60% | 月 |
| 7 日留存 | > 40% | 月 |

**商业化漏斗指标**

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 免费→任意付费转化率 | > 5% | 含单次购买 |
| 单次购买→Pro 转化率 | > 20% | 买过一次的用户更容易订阅 |
| Pro→Max 转化率 | > 15% | 讲义 + 分享链接是主要驱动 |
| Max 月流失率 | < 8% | 订阅健康度 |
| 分享链接点击率 | > 30% | 分享链接被访问说明内容有传播价值 |
| Whisper 成本 / Pro 收入 | < 10% | 字幕成本占比控制目标 |

---

## 八、风险与依赖

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| ffmpeg.wasm 渲染性能不足 | 高 | 先测试真实渲染速度；必要时降默认分辨率至 720p 或走云端渲染 |
| 人像窗口 + 画板同时渲染性能压力 | 高 | 人像窗口单独录制流，合成在导出阶段而非实时 |
| 单次购买 Token 被盗用 / 绕过 | 高 | Token 服务端验证 + 绑定 session ID + 一次性销毁，不可复用 |
| Whisper API 成本（Pro 层） | 中 | Pro 月订阅定价需覆盖每月字幕成本（~$0.18/次 × 月均使用次数），设置单月字幕调用上限（如 200 分钟/月）超额提示 |
| Max 分享链接存储成本失控 | 中 | TTL 30 天强制过期 + 单用户存储上限（如 5GB），超额自动删除最旧录制 |
| 水印被技术手段去除 | 中 | 水印叠加在内容区而非纯黑边；同时水印是品牌曝光，不是绝对防盗，接受少量绕过 |
| 背景分割 GPU 占用过高 | 中 | 默认关闭，低配设备自动禁用 |
| 白板内核 API 变更 | 中 | 锁定版本，跟踪 changelog |
| 支付退款 / 争议处理 | 中 | 单次购买无退款（数字商品已交付）；订阅按月结，随时可取消；上线前准备好退款 SOP |
| 浏览器摄像头/麦克风权限被拒 | 低 | 各自独立降级，不互相阻断 |

---

## 九、里程碑

| 阶段 | 内容 | 周期 |
|------|------|------|
| M1 | 录制 + 操作序列存储 + Web 回放 | 第 1-3 周 |
| M2 | 画幅比例选择 + 裁切框预览 | 第 3-4 周 |
| M3 | MP4 导出（ffmpeg.wasm，含比例合成）+ **水印叠加（免费层）** | 第 4-5 周 |
| M4 | **单次购买 Token 验证（无水印导出）**+ 人像窗口（摄像头采集 + 悬浮预览 + 合成） | 第 6-7 周 |
| M5 | 字幕生成 + SRT 导出（**Pro 层功能门控**） | 第 8-9 周 |
| M6 | 讲义生成（AI）+ 分享链接（OSS 上传 + TTL）（**Max 层功能门控**） | 第 10-11 周 |
| M7 | **订阅支付系统接入**（Stripe / 支付宝 / 微信支付）+ 升级引导 UI | 第 12 周 |
| M8 | 用户测试 + Bug 修复 + 上线 | 第 13-14 周 |

---

## 十、UI 设计参考

### 设计风格定位

参考 Excalicord（同类产品）的 UI 风格进行**借鉴而非抄袭**，核心设计语言：

- **深色模式为主**：录制工具类产品深色背景更聚焦，减少视觉干扰
- **克制的半透明浮层**：录制控制栏、人像窗口、字幕层均以半透明毛玻璃风格叠加在白板上，不遮挡创作区域
- **操作极简**：录制核心操作（开始 / 暂停 / 停止）一键触达，录制中界面尽可能干净

---

### 各界面 UI 规范

#### 1. 录制前：设置面板

```
┌─────────────────────────────────────────┐
│  开始新录制                          ×  │
│─────────────────────────────────────────│
│  画幅比例                               │
│  [16:9 ▼] [9:16] [1:1] [3:4] [自定义]  │
│  ████████ 裁切框预览（缩略图）           │
│─────────────────────────────────────────│
│  人像窗口    ○ 关闭  ● 开启             │
│  大小 ──●────────── 小 → 大             │
│  形状 [● 圆形] [□ 圆角矩形]             │
│  位置 [右下 ▼]                          │
│─────────────────────────────────────────│
│  麦克风     [默认麦克风 ▼]     🎤 测试   │
│─────────────────────────────────────────│
│       [取消]        [● 开始录制]        │
└─────────────────────────────────────────┘
```

- 面板以模态弹窗出现在白板中央，背景轻度模糊
- "开始录制"按钮用红色强调，其余用中性色
- Excalicord 风格：圆角大、间距宽松、图标搭配文字标签

---

#### 2. 录制中：顶部悬浮控制栏

```
┌──────────────────────────────────────────────────────┐
│  ● REC  00:03:27   ‖ 暂停   ■ 停止      [16:9] 🎤🎥  │
└──────────────────────────────────────────────────────┘
```

- 位置：画板顶部居中，半透明深色背景（rgba 黑色 70%），不遮挡裁切框
- 红点 + 计时器始终可见；暂停时红点变灰，计时器停止跳动
- 右侧图标显示当前激活的采集源（麦克风 / 摄像头）
- **录制中最小化原则**：不出现任何升级引导、通知弹窗
- 参考 Excalicord：控制栏小而精，不影响主画布操作

---

#### 3. 录制中：人像窗口

```
         ╭─────────╮
         │  👤      │  ← 圆形，border: 2px solid white
         │  摄像头  │     shadow: 0 4px 20px rgba(0,0,0,0.4)
         ╰─────────╯
              ↕ 可拖拽
```

- 默认右下角，距边缘 24px
- 悬停时出现拖拽光标 + 边框高亮
- 双击淡出（opacity 0，继续录像）再双击淡入
- 大小通过左侧/顶部滑动条实时调节，范围 120px ~ 400px
- 参考 Excalicord 的 webcam overlay 风格：干净、有阴影、不廉价

---

#### 4. 导出页 / 编辑器：录制完成后

按设计稿（`editor.jsx`）重做为**编辑器**布局：顶栏（返回 + Logo + 可改项目名 + tier 标 + Share/Export）· 左列（播放器预览 + **时间轴**）· 右列（**按 tier 分级 Tab**）。

```
┌──────────────────────────────────────────────────────────────┐
│ ←  ✎ Excalicast   [ 我的录制标题____ ]   [PRO]   Share  Export │
│──────────────────────────────────────────────────────────────│
│  ┌── 左：预览 + 时间轴 ──┐  ┌── 右：分级 Tab ───────────────┐ │
│  │  ▶  [  播放预览  ]      │  │ Export · Captions · Outline ·  │ │
│  │                        │  │ Handout                        │ │
│  │  ┌ TRIM ─ 保留 0:08 ─┐ │  │ ── Export ──                   │ │
│  │  │ Canvas ▓▓▓▓▓▓▓▓   │ │  │  画幅比例 + 工作区开关          │ │
│  │  │ Mic    ░▓▓▓▓▓░    │ │  │  ○含水印  ●无水印(单次/Pro)    │ │
│  │  │ Captions ▓▓▓▓     │ │  │  [ 渲染并下载 ] 进度条          │ │
│  │  │ ├┤裁掉  ▓保留▓  ├┤│ │  │ ── Captions(Pro) ──            │ │
│  │  └───────────────────┘ │  │ ── Outline/Handout(Max) ──     │ │
│  └────────────────────────┘  │  锁定档：LockBlock 升级块       │ │
│                              └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **顶栏**：项目名内联可编辑（复用 `updateRecordingTitle`）；tier 标签；Share / Export 按钮切到 Export Tab。
- **左列**：`ExportPreview` 播放器 + `Timeline`（时间轴裁剪，见下）+ 删除录制。
- **右列分级 Tab**（按 `useSubscription().tier`）：Export（比例 + 工作区开关 + 水印 + 导出）所有档可见；Captions=Pro、Outline/Handout=Max，锁定档渲染升级块点开 `ProUpgradeModal`。
- **功能性时间轴裁剪（单 in/out 段）**：拖左右手柄设保留区间 `[inMs,outMs]`，框外（裁掉部分）变暗；改动去抖写入 `recording.segments`，导出按段裁剪输出（见「## 十一」）。多段 Split 留作后续。
- 导出页是最重要的付费转化入口，锁定功能用 LockBlock 升级块展示，保留可见性。
- 水印预览实时渲染在播放器右下角，让用户直观感受"有水印 vs 无水印"差距。

---

#### 5. 分享页（收件方视角，Max）

```
┌────────────────────────────────────────────────────┐
│  [产品 Logo]                                       │
│  「[录制标题]」                                    │
│  作者：xxx  |  时长：03:27  |  2026-04-28          │
│────────────────────────────────────────────────────│
│                                                    │
│         ▶ 点击播放                                 │
│   ┌─────────────────────────────────────┐          │
│   │    白板回放画面（Web 播放器）         │          │
│   │    进度条 ────●──────────────────   │          │
│   │    字幕叠加在底部（如有）             │          │
│   └─────────────────────────────────────┘          │
│                                                    │
│  [📄 查看讲义]    [⬇ 导出 MP4（本地渲染）]         │
│────────────────────────────────────────────────────│
│  由 [产品名] 生成  |  创建你自己的录制 →            │
└────────────────────────────────────────────────────┘
```

- 分享页底部带产品引流入口（"创建你自己的录制"），兼顾增长
- 导出 MP4 按钮：在收件方本地渲染，不消耗服务器资源
- 设计风格：简洁、内容优先，突出白板回放和讲义

---

### 与 Excalicord 的差异化

| 维度 | Excalicord | 本产品 |
|------|-----------|--------|
| 核心定位 | 录制自己 + 白板，美化背景 | 录制过程 → 知识资产（字幕 + 讲义） |
| 人像风格 | 全身/半身，美化背景 | 人脸气泡叠加，可背景分割 |
| AI 能力 | 无（提词器辅助录制） | 字幕 + AI 讲义（核心差异） |
| 分享 | 导出视频 | 操作流回放链接 + 讲义 |
| 付费模型 | 未知 | 免费水印 / 单次 / Pro / Max |

---

## 十一、实现进展与变更记录（持续同步）

> 本章是「已实现/在建」的真实状态与变更流水。**任何 PRD 未覆盖的新功能/行为变更都必须在此追加一条**（见 CLAUDE.md「PRD 同步要求」）。前面章节为产品设计意图，本章为落地现状。

- **2026-06-08｜导出页改编辑器 1:1 重做 + 功能性时间轴裁剪（设计 Phase 3）**：
  1. **编辑器外壳 + 分级 Tab**：`/export/[id]` 按 `editor.jsx` 重做为编辑器布局——顶栏（返回 + Logo + 内联可改项目名 `updateRecordingTitle` + tier 标 + Share/Export）· 左列（`ExportPreview` 播放器 + `Timeline` + 删除）· 右列分级 Tab（Export 全档可见；Captions=Pro；Outline/Handout=Max，锁定档 LockBlock 点开 `ProUpgradeModal`）。Export Tab 复用 `ExportRatioPicker` + `WorkspaceShellToggle` + `ExportPanel`（`showAdvanced` 控制是否含字幕/讲义/分享段；Tab 化后这里关掉、由独立 Tab 承载）。
  2. **裁剪数据模型 + 时间轴交互**：`RecordingMetadata.segments?: TimeSegment[]` + `ExportConfig.segments`（ms，缺省=整段）；`updateRecordingSegments(id, segments)`（`db-client`，校验/去零长/排序，空则存 undefined）。`src/components/editor/Timeline.tsx`：单 in/out 段拖左右手柄设保留区间、框外变暗、reset 复位；改动经导出页去抖（500ms）持久化进 `recording.segments` 并同步进 `config.segments`。
  3. **导出管线按裁剪输出**：`exportPipeline` 读 `opts.segments?.[0]` 得 `trimIn/trimOut/outDurationMs`；帧只渲染落在保留段内的源时间（`t = trimIn + i/fps*1000`）、输出时间从 0 起；**裁剪时强制走 ffmpeg 兜底路径**（WebCodecs 整段编码音频无法裁音轨），音频/摄像头用 `-ss trimIn` 对齐；摄像头 overlay 的 `enable=between` 区间整体左移 `trimIn` 并钳到 `[0,outDurationMs]`；字幕烧录随帧源时间天然对齐；`-shortest` 保证输出 = 保留段时长。`default` 无裁剪时与现状完全一致。
  涉及：`src/app/[locale]/export/[id]/page.tsx`、`src/components/editor/Timeline.tsx`（新）、`src/components/ExportPanel.tsx`（`showAdvanced`）、`src/types/recording.ts`、`src/lib/db-client.ts`、`src/services/exportPipeline.ts`、`src/messages/{en,zh}.json`。

- **2026-06-06｜关键事件落库 Supabase + 后台分析 Dashboard + Library 页重做（设计 Phase 4）**：
  1. **事件分析基建**：新增 `analytics_events` 表（RLS 开启、无 client 策略，仅 service-role 读写）+ `/api/analytics`（POST，service-role insert，读登录态拿 user_id，白名单校验，始终 204 不阻塞）+ 客户端统一 `trackEvent`（`src/lib/analytics/{events,track}.ts`，双写 Vercel Analytics + `sendBeacon` 到自有库，带 sessionId/guestId/path/locale）。`TrackedLink` 与各埋点点改用 `trackEvent`。接入关键事件：`cta_start_recording`/`pricing_cta_click`/`content_cta_click`/`view_demo`/`feature_click`/`upgrade_modal_open`/`checkout_start`/`purchase_success`/`recording_start`/`recording_complete`/`recording_discard`/`export_success`/`subtitle_generate`/`handout_generate`/`share_create`/`library_view`/`library_search`/`library_filter`（`signup`/`login` 暂留白名单未接，避免页面加载噪声）。
  2. **后台分析 Dashboard**：`/admin/analytics`（`ADMIN_SECRET` 鉴权、`noindex`、手绘风、无图表库）+ `/api/admin/analytics`（service-role 聚合：summary 卡片 / 转化漏斗（cta→录制→完成→导出→结账→付费 + 转化率）/ 近 N 天时间序列 / 事件排行 / 最近事件；range 7/30/90 天）。
  3. **Library 页 1:1 重做**：`/library` 加搜索框（按标题）+ 筛选 chip（全部/未完成/已备份/仅本地）+ 排序（最新/最早/最长）+ grid/list 视图切换 + 列表视图；`RecordingsList` 原有云同步/批量备份/重命名/上传下载/删除逻辑全部保留，仅叠加过滤/排序/视图层。
  涉及：`supabase/migrations/20260605120000_analytics_events.sql`、`src/app/api/{analytics,admin/analytics}/route.ts`、`src/app/[locale]/admin/analytics/{layout,page}.tsx`、`src/lib/analytics/*`、`src/components/{analytics/TrackedLink,ProUpgradeModal,PaywallModal,ExportPanel,SubtitlePanel,HandoutPanel,RecordingsList}.tsx`、`src/app/[locale]/{app,library}/page.tsx`、`src/messages/{en,zh}.json`。

- **2026-06-05｜修 Excalidraw CDN 崩溃 + 裁切框可拖拽缩放 + 摄像头限框内 + 自定义改框选**：
  1. **ChunkLoadError 修复**：Excalidraw 字体/资源原从 `unpkg.com` CDN 加载（`Whiteboard.tsx` 未设 `EXCALIDRAW_ASSET_PATH`），CDN 不可达即整页崩。改为**自托管**：`window.EXCALIDRAW_ASSET_PATH='/'` + `scripts/copy-excalidraw-assets.mjs` 在 `predev`/`prebuild` 把 `excalidraw-assets[-dev]` 复制进 `public/`（`.gitignore` 忽略，不入库）。
  2. **裁切框可交互**：`AspectCropOverlay` 从静态参考框升级为可拖拽移动 + 四角缩放（预设锁该比例 / Custom 自由比例），钳制在画布区内；裁切框存为画布区比例 `CropWindow{rx,ry,rw,rh}`，导出对每帧取视口对应子矩形（`cropping.ts` follow_viewport 分支 + `exportPipeline`）。停止录制时持久化进 `recording.setup.cropWindow`，导出默认沿用；导出页改比例偏离录制 framing 时自动回退居中。
  3. **摄像头限框内**：选定裁切框（非 default）后，人像气泡只能在裁切框屏幕矩形内拖动（app 页 `handleCameraPositionChange` 钳制）。
  4. **自定义改框选**：Setup 的 Custom 去掉填像素 W×H（无感知），改为「画布上自由框选」+ 框旁 W×H 输入实时双向联动预览；输出尺寸 `customOutput` 由框选区域换算（≤1920 取偶）或用户手输，导出按之输出（`ExportConfig.customOutput`）。
  涉及：`Whiteboard.tsx`、`scripts/copy-excalidraw-assets.mjs`、`package.json`、`.gitignore`、`types/recording.ts`、`services/{cropping,exportPipeline}.ts`、`components/{AspectCropOverlay,RecordingSetup}.tsx`、`app/[locale]/{app,export/[id]}/page.tsx`、`messages/{en,zh}.json`。

- **2026-06-04｜录制前 Setup 面板 + 比例锁定 + 画布裁切框（设计重构 Phase 2）**：把画幅比例从「仅导出时选」前置到「录制前锁定」。
  1. **Setup 面板**（`src/components/RecordingSetup.tsx`，照设计稿 setup.jsx 1:1）：idle 点「开始」先弹面板——比例分组 tab（默认整画板 / 横屏 / 竖屏 / 方形 / 自定义 W×H）+ 摄像头气泡配置（开关 / 尺寸滑块 80–480 / 形状 / 九宫格位置 / 背景抠除开关）+ 麦克风 + 「包含工作区界面」开关（对所有比例都出现）+ 底部「全程本地」+ 3 秒倒计时开始。
  2. **比例集扩展**：`AspectRatio` 从 4 个扩到 10 个预设（16:9/4:3/21:9/16:10/3:2/9:16/4:5/3:4/2:3/1:1，含 group + 平台 hint），`cropping.ts` 把 aspect 仅当数字用故无破坏。
  3. **配置随录制持久化**：`RecordingSetupConfig` 存进 `RecordingMetadata.setup`（`framing`/`croppingMode`/`includeWorkspaceShell`/`customW,H`/`camera{...}`）；导出页据此设默认 ExportConfig（`framing=default`→fit_all_content；custom→最接近预设；含工作区沿用）。
  4. **画布裁切框 viewfinder**（`src/components/AspectCropOverlay.tsx`，照 recording.jsx CropFrame）：录制中固定比例时画框外蒙层 + 虚线框 + 四角括号 + 比例徽标 + px 标注；`default` 整画板不画。控制栏录制态加比例徽标。
  5. **边界**：背景抠除本轮仅存开关、不接实时 mediapipe 分割（PRD 标可选 GPU 特性）；自定义比例在导出层映射到最接近预设。
  涉及：`src/types/recording.ts`、`src/lib/db-client.ts`(类型)、`src/services/recordingSession.ts`、`src/app/[locale]/app/page.tsx`、`src/components/{RecordingSetup,AspectCropOverlay,RecordingBar,icons}.tsx`、`src/app/[locale]/export/[id]/page.tsx`、`src/messages/{en,zh}.json`。

- **2026-06-04｜会员年付价格 + 去团队席位收费**：
  1. **去团队席位**（仅 UI/文案）：定价页 Max 套餐权益删「团队席位（最多 3 个）」、特性矩阵删「团队席位」行、删 FAQ「团队怎么办」（q6）。涉及 `src/messages/{en,zh}.json`、`src/app/[locale]/pricing/page.tsx`（`MATRIX.account` 改为 2 行权益 + FAQ 渲染 q1–q5）。`src/content/use-cases.ts` 里「录给团队看」是使用场景内容，保留不动。
  2. **年付价格全链路**：`payment_config` 加 4 列 `pro_yearly_price_cents`(默认 9590) / `max_yearly_price_cents`(默认 15350，即月价×12×0.8 省 20%) / `pro_yearly_product_id` / `max_yearly_product_id`（默认 NULL）。`/api/checkout/pro` 入参加 `billing:'monthly'|'yearly'`，年付选对应年付 product id（缺失→`creem_creds_missing`）；月/年订阅周期由 **Creem 按 product 自动报回**，creem-webhook 无需改。`toPublic()` 暴露两档年价 + `yearlyAvailable`（两个年付 product id 都非空才 true，**product id 不暴露**）。升级弹窗 `ProUpgradeModal` 与定价页 `PricingTiers` 仅在 `yearlyAvailable` 时显示月/年切换；定价页年付按「折合每月」展示。admin `/api/admin/payment-config` 接受 4 个年付字段并把 Creem 价格校验扩展到 `pro_yearly`/`max_yearly` 槽位。新增迁移 `supabase/migrations/20260604120000_payment_config_yearly.sql`（ADD COLUMN + 按行回填年价）。涉及 `src/lib/paymentConfig.ts`、`src/app/api/checkout/pro/route.ts`、`src/app/api/admin/payment-config/route.ts`、`src/components/ProUpgradeModal.tsx`、`src/app/[locale]/pricing/{page,PricingTiers}.tsx`、`src/messages/{en,zh}.json`。**注**：真实年付下单需先在 Creem 建年度循环 product 并用 admin API 填 `*_yearly_product_id`，未填则前端隐藏年付、仅月付。

- **2026-06-01｜IndexNow 即时收录 + 域名约定固化**：
  1. **IndexNow**（加速 Bing/Yandex/Seznam/Naver 收录新站）：新增密钥文件 `public/e0db09f0b1ee71fc3abbf04e5909381f.txt` + 提交脚本 `scripts/indexnow.ts`（复用 `allContentRoutes()` 生成全量双语 URL POST 到 `api.indexnow.org`，支持 `--dry-run`，部署/加内容后手动跑）。`docs/launch-checklist.md` 增 IndexNow 用法 + 新站收录预期章节。诊断结论：GSC/Bing 报的「重复未选规范页 / 自动重定向 / known but has issues」均为新域名初次索引正常瞬时态，markup 实测无误，主加速杠杆是外链 + 请求编入索引 + IndexNow。
  2. **域名约定写入 CLAUDE.md**：站点/canonical/SEO/IndexNow = `excalicast.cc`；客服邮箱 `support@excalicast.cn`（`.cn` 故意，禁止"顺手"改）。

- **2026-06-01｜枢纽博客内链图谱 + 上线清单（推广第三阶段）**：
  1. **内链图谱**：`src/content/types.ts` 加 `ContentRef` + 各内容类型可选 `related?`；新增 `src/components/content/RelatedLinks.tsx`（解析 ref → 本地化标题链接，复用 `EntryList`），在 compare/use-cases/blog 三个 `[slug]` 模板的 CtaRow 前渲染。
  2. **3 篇枢纽博客**（`src/content/blog.ts`，hub-and-spoke）：`loom-alternatives-for-whiteboard`、`repurpose-one-recording-into-shorts-reels`、`record-whiteboard-lectures-online-teaching`，各 `related` 链向多个对比/场景页；并给 2 篇原博客 + vs-loom / record-whiteboard-lecture / whiteboard-video-for-youtube-shorts 回填双向 `related`。博客增至 5 篇，全自动进 sitemap。
  3. **上线清单**（`docs/launch-checklist.md`）：Vercel 开 Analytics、冒烟测试、GSC/Bing 提交、富结果/OG 校验、埋点事件验证、GEO 抽测。**标记域名一致性阻断项**：SEO 用 `excalicast.cc`，footer/邮箱用 `excalicast.cn`，上线前需二选一统一（未擅自改，待定夺）。

- **2026-06-01｜内容扩量 + 转化埋点 + Demo 脚本（推广第二阶段）**：
  1. **长尾页扩量（+11，纯数据）**：`src/content/compare.ts` 加 6 对比页（vs Scribe / Excalidraw / Screen Studio / Tella / VEED / Zoom 录制），`src/content/use-cases.ts` 加 5 场景页（数学讲题 / PM 需求讲解 / 在线课程 / 系统设计讲解 / 白板视频加字幕），双语完整；`[slug]` 模板、`generateStaticParams`、sitemap、hreflang、FAQ JSON-LD 全自动收录，零路由改动。
  2. **转化埋点（Vercel Analytics 自定义事件）**：新增 `src/components/analytics/TrackedLink.tsx`（'use client' 包装 i18n Link + `track()`）。落地页 6 个 CTA（nav/hero `cta_start_recording`、四档 `pricing_cta_click{tier}`）与内容页 `CtaRow`（`content_cta_click{type,slug}`）换 TrackedLink；`PaywallModal`/`ProUpgradeModal` 加 `checkout_start` 与 `purchase_success{kind,tier}`；`ExportPanel` 导出/字幕/讲义/分享加 `feature_click{feature,gated}`。**只加埋点，不改业务/支付/门控逻辑**。
  3. **Demo 视频**：`docs/demo-video-script.md`（业界工具地图 Screen Studio/Descript/ElevenLabs/Arcade 等 + 45–60s 主脚本 + 12–15s 竖屏短版，中英双语分镜）。

- **2026-06-01｜SEO + GEO 推广基建 + 程序化内容引擎（冷启动）**：为零预算自然流量获客落地三层能力（详见新增「## 十二、SEO / GEO / 内容营销」与 `docs/marketing-cold-start.md`）。
  1. **技术 SEO 地基**：`[locale]/layout.tsx` 加 `metadataBase` + 全站 OpenGraph/Twitter 默认值 + 标题模板；landing `page.tsx` `generateMetadata` 补 canonical/hreflang（`x-default=en`）；新增 `src/app/sitemap.ts`（遍历 locale × 路由 + hreflang）、`src/app/robots.ts`、`src/app/[locale]/opengraph-image.tsx`（动态 1200×630 OG 图，品牌 paper/ink 配色）；`middleware.ts` matcher 排除 `sitemap.xml/robots.txt/llms.txt/opengraph-image`；接入 `@vercel/analytics` + `@vercel/speed-insights`。复用工具 `src/lib/seo/{alternates,meta,schema}.ts`。
  2. **GEO（让 AI 引擎引用 excalicast.cc）**：新增 `src/components/seo/JsonLd.tsx`；landing 注入 `SoftwareApplication`（offers 三档价格从 `payment_config` 实时读）+ `Organization` + `FAQPage`（新增 `landing.faq.q1–q4` 双语文案）；内容页注入 `FAQPage`/`BreadcrumbList`/`Article`；新增 `src/app/llms.txt/route.ts`（llmstxt.org 约定的 AI 站点说明书，价格实时）；robots 显式放行 GPTBot/PerplexityBot/ClaudeBot/Google-Extended 等 AI 爬虫。
  3. **程序化 SEO 内容引擎**：新增数据层 `src/content/{compare,use-cases,blog}.ts`（双语 typed data，无 CMS/MDX 依赖）+ 动态路由 `[locale]/{compare,use-cases,blog}/[slug]` 与 hub 列表页（Server Component 静态渲染，`generateStaticParams` 预渲染全部 slug，自动进 sitemap）；首批 3 对比页（vs Loom/tldraw/录屏）+ 3 use-case + 2 blog；landing 页脚加内容入口（`footer.compare/useCases/blog` 双语键）；脚手架 `scripts/new-content.ts`（一行命令加长尾页）。
  4. **运营手册**：`docs/marketing-cold-start.md`（Search Console/Bing 接入、ProductHunt/Show HN/Reddit 可照抄文案、Excalidraw 生态借力、GEO 写作铁律、统一话术、衡量口径）。

- **2026-05-31｜定价页权益补全 + 文案净化 + logo 回落地页 + 摄像头缩放 + 修到期 bug**：
  1. **定价页四档权益补全 + 口径校准**（`page.tsx` + `messages/{zh,en}.json` 的 `landing.pricing.*`）：free/one_time/pro/max bullets 按 `TIER_PERMISSIONS` 真实权益列全；**校准「全档不限时长」**（删 free「最长 30 分钟」、删 Pro「无限录制时长」专属卖点，与 `supabase/README.md` 硬约束一致）；**支付商文案按 active provider 动态显示**（落地页 `getActiveConfig().provider` → Creem/Paddle 名称与链接，`oneTime.bullet4`/`methods`/`processedBy` 改用 `{provider}` 变量与 `<link>`，不再写死 Paddle）。
  2. **面向用户文案去实现细节词**：导出页/升级弹窗去掉 `Deepseek`（讲义）与 `AI`（字幕/讲义）字样（`exportPanel.*`、`proUpgrade/maxUpgrade.features`、`landing.pricing.pro/max`）；服务端模型调用不变（字幕=千问、讲义=deepseek）。
  3. **应用内 logo 回落地页**：`AppHeader.Brand` 链接 `/app` → `/`。
  4. **摄像头气泡可缩放**：`CameraBubble` 加右下角缩放手柄 + `onSizeChange`（边长 80–480），`app/page.tsx` 加 `cameraSize` 状态/持久化并接入 `recordCameraMove`；录制存储与导出管线本就按 `sizePx` 工作，故纯前端补全。
  5. **修会员到期 bug**：`past_due`（扣款失败宽限期）此前被立即降级为 free；`src/lib/tier.ts` 与 `/api/me/tier` 两处统一把 `past_due` 视为仍有权益（宽限期结束支付商推 `cancelled` 再按期末降级）。

- **2026-05-31｜支付回流到发起页 + 登录邮件品牌化**：
  1. **支付成功回到发起页**：Creem checkout 的 `successUrl` 不再写死 `/app`，改为透传发起页路径 `returnTo`（前端取 `window.location.pathname`），让新标签页付完后回到**发起支付的导出页** `/[locale]/export/[id]`（而非通用 `/app`）。涉及 `ProUpgradeModal`/`PaywallModal`（fetch body 加 `returnTo`）、`/api/checkout/pro`、`/api/checkout/one-time`（读取并按 `startsWith('/') && !startsWith('//')` 校验防开放重定向，非法回退 `/app`）。导出页 `export/[id]/page.tsx` 新增消费 `?creem_purchase=` 参数：弹「支付完成·已解锁」轻提示 + 清掉 query；解锁态由 `ExportPanel` 新鲜挂载自动拉取，返回标签**不自动重启导出**（避免丢失原标签所选比例/去水印配置）。原标签的 `visibilitychange/focus` 重查续上逻辑不变。
  2. **登录邮件品牌化（Supabase Auth）**：仓库新增 Excalicast 品牌邮件模板 `supabase/templates/{magic_link,confirmation}.html` + `supabase/config.toml`（`[auth.email.template.*]` 标题/正文 + `[auth.email.smtp]` 自定义 SMTP 引用 env），`.env.local.example` 增 `SMTP_*`、`supabase/README.md` 增《自定义登录邮件品牌》操作手册。真正生效需在 Supabase Dashboard 配模板 + 自定义 SMTP（推荐 Resend，需 DNS 验证 `excalicast.cc`）或 `supabase config push`；代码发送链路（`signInWithOtp`/`emailRedirectTo`）无需改动。

### 11.1 已落地能力概览（截至 2026-05-30）

**定价与会员（四档：free / one_time / pro / max）**
- 价格唯一来源 = `payment_config`（多行表，creem/paddle × live/test，`is_active` 切换）。当前价：one-time **$4.99 (499)** / Pro **$9.99 (999)/mo** / Max **$15.99 (1599)/mo**。
- 价格全站单一来源：服务端页面 `getActiveConfig()`、客户端 `usePaymentConfig()`（`/api/payment/provider`，`force-dynamic + no-store` + Supabase Realtime 广播即时刷新）。落地页/条款页 `force-dynamic`，改库即更新。月费后缀统一：en `/mo`、zh `/月`。
- **Max 可购买（两渠道）**：`payment_config` 含 `max_monthly_price_cents` / `max_product_id`；`/api/checkout/pro` 按 `{tier:'pro'|'max'}` 选品；Paddle 客户端与 Creem metadata 透传 tier；Creem/Paddle webhook 按 metadata/custom_data 解析真实 tier 入 `user_subscriptions`。
- 升级弹窗 `ProUpgradeModal` 参数化 `tier`（Pro/Max 品牌、价格、文案、轮询）；落地页定价区四档卡片。
- 权限门控 `TIER_PERMISSIONS`；服务端 `requireTier()` 守卫 `/api/share/*`、`/api/handout/*`（Max）。

**素材库 / 模板（library）**
- 录制库 + 模板库/模板市场（marketplace）；Pro/Max 登录后模板**跨设备云端同步**（`library_items_cloud`，软删 tombstone）。免费档上传门控。

**录制增强**
- 多画幅比例 + 裁切框；人脸气泡（可拖拽/缩放/双击隐藏，录制中可调）；激光笔（laser pointer）；录制中切换摄像头；离屏渲染隔离（不录屏幕像素）。

**导出 / 回放 / 分享**
- ffmpeg.wasm 本地导出 MP4（含人像叠加、字幕烧录、免费档水印）；操作流 Web 回放；**分享链接**（Max，`share_links`，仅事件流+音频，30 天 TTL，公开页 `/s/[short]` 客户端重渲染）。

**字幕 / 讲义（AI）**
- 字幕：阿里千问/Paraformer（DashScope，`subtitle_jobs`），SRT，Pro。
- AI 讲义：Deepseek 生成结构化讲义（`handouts` 表，Max），章节 + markdown。

**品牌**：浏览器 favicon + apple touch icon。

### 11.2 变更记录（按时间倒序）

- **2026-05-31｜code-review 修复（8 项）**：
  - 本地隔离加固：`RecordingsList` 等 `useAuth.loading` settle 后才列表/认领（避免用 guestId 误认领 legacy）；`listRecordings` 改用 ownerKey 索引查询、不再回退返回 legacy。
  - by-id 越权：`getRecording/loadFullRecording/deleteRecording` 加可选 `ownerKey` 校验；`/export/[id]`、`/play/[id]`、`RecordingsList` 删除均传当前 ownerKey（他号经 id 无法查看/删除）。
  - 支付 `recheck` 用 `pollingRef` 互斥（避免 focus+visibility 并发双触发 onPaid/onUpgraded）。
  - `getCurrentOwnerKey` 改用 `auth.getSession()`（本地无网络，录制启动不阻塞、不因网络抖动误归 guest）。
  - 清理：`BundleCard` 合并 Pro/Max 卡头部重复（删 `MaxBundleCard`/`ProBundleCard`）；`getOrCreateGuestId` 标注仅客户端。
- **2026-05-31｜本地隔离 + 支付回跳 + Pro 功能卡**：
  1. **本地录制按用户隔离**（隐私）：`recordings` 加 `ownerKey`（登录=user.id / 匿名=guestId，新 `src/lib/ownerKey.ts`），Dexie v9；`listRecordings(ownerKey)` 过滤 + legacy 认领；匿名→登录 `migrateRecordingsOwner`；`RecordingsList`/`library` 随登录态取 ownerKey。同设备多账号互不可见。
  2. **支付后回跳/恢复**：`PaywallModal`/`ProUpgradeModal` 在标签 `visibilitychange`/`focus` 时立即重查 isPaid / tier（补足轮询超时）——导出自动恢复、订阅回到已解锁面板（不自执行）；`/app` 消费 `?creem_purchase=` 显示「支付完成」提示并 `history.replace` 清参（修死页）。Paddle overlay 不变。
  3. **ExportPanel「Pro 功能」卡**：新增 `ProBundleCard`（仿 `MaxBundleCard` 布局），行1 字幕、行2「跨设备云端保存模板/多端同步素材库」（被动权益无按钮）；`MaxBundleRow` 按钮改可选；移除旧 `FeatureRow`。
- **2026-05-30｜字幕云端同步修复**：先上传云端、后生成字幕时，字幕只写本地 IndexedDB、未更新 `recordings_cloud.subtitle_srt`，导致分享/讲义看不到字幕。新增 `updateCloudRecordingSubtitle`，`PATCH /api/recordings/[id]` 支持 `subtitleSrt`，`SubtitlePanel` 生成/移除字幕后 best-effort 同步云端（未上云 404 忽略）。
- **2026-05-30｜第七轮 · 定价卡对齐 + 摄像头导出提速 + 摄像头存储压缩**：
  1. 生产定价不更新**根因**（非代码）：active 行是 `creem/test`，页面只读 active 行；改的是别的行。修复=改 active 行或 `activate` 切 live。同步机制：落地页 force-dynamic 刷新即生效；弹窗经 admin API 改才有 Realtime 推送（直接改库需刷新）。
  2. 定价页四卡 CTA 按钮底部对齐（卡片 flex column + bullets `flex-grow`）。
  3. **含摄像头导出也走 WebCodecs**：新增 `webmCameraFrames.ts`（极简 WebM 解复用 + `VideoDecoder` 流式出帧），`exportPipeline.composeFrame` 在画布内合成摄像头气泡（镜像/圆形/定位与 ffmpeg overlay 对齐）；解码不可用/失败 → 回退 ffmpeg(JPEG)。
  4. 摄像头存储压缩：采集端 `cameraRecorder` 800k→300kbps、480→360、24fps（项4）；上传前 `transcodeCameraForUpload`（VideoDecoder 解 → VP9 ~220k/15fps 重编码 → `webm-muxer` 同名 camera.webm），失败原样上传（项5）。新增依赖 `webm-muxer`。
  5. Supabase 500MB 容量预估：无摄像头 ~0.3MB/min；含摄像头原 800k ~6.3MB/min（压缩后大幅下降）。
- **2026-05-30｜第六轮 · 导出大幅提速**：瓶颈是每帧 JPEG/PNG 编码 + ffmpeg 单线程 libx264。两条腿：
  1. **兜底（ffmpeg 路径，全浏览器）**：中间帧 PNG→**JPEG**(Q0.92)，`toBlob`/MemFS/解码均更快。
  2. **主路径（WebCodecs，硬件编码）**：新增 `src/services/webCodecsExport.ts`（依赖 `mp4-muxer`）——`VideoEncoder`(H.264，优先硬件) 直接吃 canvas 帧 + `AudioEncoder`(AAC) + mp4-muxer 混流，去掉 PNG 序列与 ffmpeg 软编。`exportPipeline` 抽出 `frameInputs`/`composeFrame` 供两路共用；当 `VideoEncoder/AudioEncoder` 可用且**无摄像头**时走 WebCodecs，否则/异常自动回退 ffmpeg(JPEG)。
  - 已知取舍：**有摄像头的导出仍走 ffmpeg(JPEG) 路径**（WebCodecs 无容器解复用，摄像头逐帧合成需 webm demux + VideoDecoder，列为后续增强）。
- **2026-05-30｜定价页/退款政策微调**：定价页「推荐」徽标从「单次解锁」卡移到 **Pro 卡**（Pro 成为主推：6px 阴影 + 徽标）；单次/Pro 价格仍由 `payment_config` 驱动（落地页兜底 $4.99/$9.99/$15.99）。**退款政策改为：单次无水印导出为即时交付的数字商品、不退款，唯一例外为已扣款未解锁**（更新 landing `refund.body`、`/refund` 页 `RefundEn/Zh`、`terms` §4，中英同步）。
- **2026-05-30｜第五轮（修复第四轮回归）**：
  1. 导出报错 `ArrayBuffer already detached`：帧去重复用 buffer 被 `ffmpeg.writeFile` transfer detach；改为写入传 `buf.slice()` 副本、保留 `lastBuf`。
  2. 字幕不再截断：单行固定高度 + **长句分页**（`frameOverlays` 新增 `subtitleLayout`/`chunkByWidth`/`subtitlePageIndex`，导出与 `SubtitleOverlay` 共用，按时间翻页）；导出去重签名并入字幕页索引以免翻页卡住。
  3. 口水词全面过滤（`srtParser.cleanSubtitleText`）：第 1 档全局删迟疑音（呃/嗯/唔/呣、um/uh/erm/er/hmm/mm），第 2 档边界删感叹词（啊/哦/噢/唉/诶/呢/嘛/额/哼、ah/eh/oh/huh）；第 3 档话语标记（那个/就是/well/like 等）按需保留不动。
- **2026-05-30｜第四轮迭代（代码已实现，构建通过；运维项见下）**：
  1. 讲义：报 `cloud_recording_required` 时就地「保存到云端并重试」（`HandoutPanel`/`ExportPanel` 复用 `uploadRecording`）。**运维**：线上需应用迁移 `20260524120000_max_features`（建 `handouts`/`share_links`，修复生成讲义 500）。
  2. 录制性能：elapsed 计时 250→1000ms（`app/page.tsx`）；DOM 截屏 `workspaceShellCapture` 降频（periodic 3→5s、gap 800→1500ms、debounce 250→1000ms）+ 指纹延后到防抖回调；`CameraBubble` 拖拽 rAF 节流。
  3. 分享移动端：`SharedPlayer` 改为**按容器实测尺寸 fit 裁切区/内容**（`computeContentBounds`+`fitView`，弃用录制时桌面 scroll/zoom）+ ResizeObserver；激光层共用同一变换；`[locale]/layout.tsx` 加 `viewport`（viewport-fit=cover）。
  4. 导出提速（`exportPipeline.ts`）：全等帧去重 + **基帧缓存**（场景静止仅字幕变时只重画字幕）；ffmpeg `ultrafast`→`veryfast -crf 23`。（水印为实时毛玻璃取样，未做静态缓存以保观感。）
  5. 价格线上不更新：代码已正确（provider API 全动态、落地页 `force-dynamic`、无静态导出）。**运维**：把本分支部署到生产 + 确认线上库价。
  6. 字幕：`srtParser.cleanSubtitleText` 单点清洗（去句末标点 + 保守去开头语气词，纯口水词段丢弃）；`SubtitleOverlay` 与导出 `drawSubtitle` 均**单行固定高度**（超长省略号）。
  7. **讲义智能配图**：`handout.ts` schema 增 `keyframes`（AI 仅在字幕强调/操作处挑点，≤8）；`HandoutPanel` 加「带配图」开关，客户端 `renderPreviewFrame` 渲染缩略图归入对应章节，导出 **Markdown / HTML / PDF**（新增依赖 `marked`；PDF=打印另存）。
  8. 分享加载（`s/[short]/page.tsx`）：画布只等 snapshots 即渲染，音/画改签名 URL 直接 `src` 流式、逐资源容错（修复加载慢/加载不出来）。
- **2026-05-29｜定价四档 + Max 可购买 + 价格一致性**（commit 2311273）：见 11.1「定价与会员」。
- **2026-05-29 前｜素材库市场 + 云同步、激光笔、录制中切摄像头、品牌 favicon、Pro/Max 云备份**（见 git 历史 c61a1d5 / ab91766 / e461644 / 1157429 / cd77850）。

---

## 十二、SEO / GEO / 内容营销（自然流量获客）

> 目标：零预算、海外先行的双语，通过自然搜索 + AI 引擎引用获客。本章为产品设计意图，落地现状见「## 十一」2026-06-01 条；人工执行的渠道手册见 `docs/marketing-cold-start.md`。

### 12.1 技术 SEO 地基
- **统一来源**：`SITE_URL = https://excalicast.cc`（`src/lib/seo/alternates.ts`）。`[locale]/layout.tsx` 设 `metadataBase` + 全站 OpenGraph/Twitter 默认值 + 标题模板 `%s · Excalicast`（landing 用 `title.absolute` 避免二次包裹）。
- **sitemap / robots**：`src/app/sitemap.ts` 遍历 `locales × (营销页 + 内容页)`，每条带 `zh-CN/en/x-default` hreflang；`src/app/robots.ts` 放行通用爬虫，`Disallow /api /app /library /s/`。
- **hreflang**：`buildAlternates(path, locale)` 产出 canonical + languages（`x-default = en`，海外先行）。所有营销页/内容页 `generateMetadata` 复用 `pageMetadata()`（`src/lib/seo/meta.ts`）。
- **OG 图**：`[locale]/opengraph-image.tsx` 用 `next/og` 动态生成 1200×630（品牌 paper/ink 配色 + 比例徽标），自动注入所有页 og:image/twitter:image。
- **Analytics**：`@vercel/analytics` + `@vercel/speed-insights` 挂在 layout。
- **约束**：`/app`、`/library`、`/s/[short]` 不进 sitemap（Client-only / 私有）。`middleware.ts` matcher 排除 SEO 路由。

### 12.2 GEO（Generative Engine Optimization）
让 ChatGPT / Perplexity / Google AI Overview / Claude 在相关提问中引用并推荐 excalicast.cc：
- **JSON-LD**（`src/components/seo/JsonLd.tsx` + `src/lib/seo/schema.ts`）：landing 注入 `SoftwareApplication`（`offers` 三档价格从 `payment_config` 实时读，`featureList` 用具体事实句）+ `Organization` + `FAQPage`；对比/场景页注入 `FAQPage` + `BreadcrumbList`；博客注入 `Article`。
- **llms.txt**（`src/app/llms.txt/route.ts`）：llmstxt.org 约定的 AI 站点说明书，含定义、差异化、实时三档价格、关键页链接。
- **AI 爬虫放行**：robots 显式 Allow `GPTBot / OAI-SearchBot / PerplexityBot / ClaudeBot / Google-Extended / Applebot-Extended / CCBot`。
- **内容写作铁律**：首句自包含定义句、具体数字、对比表 + FAQ 结构（见手册 §1.1）。

### 12.3 程序化内容引擎
- **数据层**：`src/content/{compare,use-cases,blog}.ts` 为双语 typed data（无 CMS / MDX 依赖，随仓库部署），类型见 `src/content/types.ts`。
- **路由模板**：`[locale]/compare/[slug]`、`[locale]/use-cases/[slug]`、`[locale]/blog/[slug]` + 三个 hub 列表页，均 Server Component 静态渲染，`generateStaticParams` 预渲染全部 slug，sitemap 自动收录（`allContentRoutes()`）。
- **扩量**：`scripts/new-content.ts` 一行命令打印骨架 → 填双语字段（或交 AI 按写作铁律起草）即多一个长尾着陆页，**无需碰路由代码**。
- **首批内容**：对比页 vs Loom / tldraw / 录屏；use-case 录白板讲座 / 异步架构讲解 / 短视频白板讲解；blog 不录屏录白板 / 一录多比例。

### 12.4 衡量
Vercel Analytics（来源/转化）+ Google Search Console / Bing Webmaster（查询曝光、索引覆盖）。重点盯 `/compare/*`、`/use-cases/*` 曝光起势，按 Search Console 已有曝光词补页。GEO 每两周抽测（Perplexity/ChatGPT 问「Loom alternative for whiteboard」等是否引用）。

