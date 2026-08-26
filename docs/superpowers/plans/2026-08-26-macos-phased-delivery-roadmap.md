# Excalicast macOS 分阶段交付路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在最新本地 `fix/loading-recording` Web 产品基础上，以一个持续使用的 Mac 工作树和逐任务 Git 提交，分阶段交付全局录制、白板、AI Camera、Auto Zoom、智能提词器、一键成片和正式发布。

**Architecture:** Electron 提供全局窗口、快捷键和安全 IPC；Swift Helper 负责 ScreenCaptureKit、AVFoundation、VideoToolbox 和流式媒体；React/Excalidraw 复用 Web 品牌与编辑能力。每阶段只在上一阶段真实 packaged 门禁通过后进入，后续阶段在用户进一步细化前不得实施。

**Tech Stack:** Next.js/React、Excalidraw、Electron、TypeScript、Swift 6、ScreenCaptureKit、AVFoundation、VideoToolbox、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-26-macos-phase-1-global-recorder-unified-board.md`

## 全局约束

- 只使用一个基于实施时最新本地 `fix/loading-recording` 的 Mac 工作树；所有阶段在该工作树连续开发。
- 每个可独立审查的 RED→GREEN 任务必须单独提交；禁止跨阶段大提交。
- Mac 保留 Excalicast Web 的配色、Logo、字体和组件家族，只吸收 Screen Studio 的 Apple 式完成度。
- Mac 冷启动只显示全局录制条，白板隐藏；Stop 后自动进入该录制的导出/成片界面。
- 绘图始终使用单一 Excalidraw scene；透明 Ink 与完整白板由背景透明度连续过渡，浮动/全屏只是窗口几何属性。
- 可见步骤完成后必须提供真实产品截图；mock bridge、旧 DMG、旧工作树或错误进程截图无效。
- 后续阶段标记为“待细化”时，只允许调研和补规格，不允许实现或宣称完成。

---

## 交付准备：旧工作树收编（不计入产品阶段）

状态：已确定收编策略，尚未执行。

- [ ] 将权威本地 `fix/loading-recording` 的有效未提交工作先形成可审计提交。
- [ ] 从该最新本地提交创建唯一稳定 Mac 工作树和 `codex/` 分支。
- [ ] 冻结现有临时 Mac 工作树，为每个工作树记录 branch、HEAD、dirty 文件和提交归属。
- [ ] 已提交能力按提交逐项审查和 cherry-pick；无提交工作先拆成可测试 commit，再迁入。
- [ ] 重复实现只保留一份；构建产物、旧 DMG、临时报告和被替代实验不得迁入生产分支。
- [ ] 每批迁入后执行目标测试、双 typecheck、Swift contract、diff-check 和 fresh review。
- [ ] 完成 commit→requirement→test→runtime evidence 映射后，才归档多余工作树。

## 第一阶段：全局录制条、统一白板与基础录制

状态：**已沟通细化；以第一阶段规格为准。**

- [ ] 冷启动只显示全局紧凑录制条，白板和 Studio 隐藏。
- [ ] 全局快捷键召回录制条、白板、暂停/继续和停止。
- [ ] 单一 Excalidraw scene 支持完整工具、自动保存和命名快照。
- [ ] 背景透明度连续实现透明 Ink→半透明→完整白板。
- [ ] 同一白板支持全屏覆盖和可移动、resize 的浮动窗口。
- [ ] 工具条可移动、折叠、隐藏；绘制、点击穿透和隐藏状态明确。
- [ ] 真实录制显示器、应用、窗口、区域、mic、system audio 和白板事件。
- [ ] Stop 安全收尾并自动进入该录制导出界面。
- [ ] 登录完成聚焦当前 Mac 录制条，不落入旧 Web 页面。
- [ ] 完成真实 packaged E2E、逐步骤截图和阶段复审。

详细规格：`docs/superpowers/specs/2026-08-26-macos-phase-1-global-recorder-unified-board.md`

## 第二阶段：AI Camera

状态：**目标级清单，等待用户进一步细化。**

- [ ] 同一 AVFoundation 会话同时产出独立摄像头原始轨和有界实时预览。
- [ ] Camera 浮窗可移动、resize、吸附、按显示器记忆并排除屏幕捕获。
- [ ] 支持气泡、完整人像、隐藏画面和关闭硬件四类真实状态。
- [ ] 录前显示真实设备、权限、首帧和硬件编码 readiness。
- [ ] 布局事件进入可编辑时间线，预览和导出共享同一契约。
- [ ] 定义并确认镜像、默认位置、形状、过渡、多人脸和断连恢复体验。

进入细化前需要用户确认：Camera 默认形态、可选形状、完整人像构图、镜像策略和控制入口。

## 第三阶段：Auto Zoom 与自动镜头

状态：**目标级清单，等待用户进一步细化。**

- [ ] 继承 Web 手动 Auto Zoom 片段、焦点框、倍率、缓动和时间线编辑。
- [ ] 从 click/dwell、窗口、scroll、Ink、speech 等遥测生成确定性镜头。
- [ ] 支持 Full Context、Focus、Follow、Reveal、Hold 及安全区和迟滞。
- [ ] 录后自动结果可编辑、可关闭、可重生成和重新预览。
- [ ] Auto Zoom 只作用于录制内容，不缩放白板工具条、Camera 主体框或背景。
- [ ] 用黄金帧与 A/V 标记验证预览和最终导出一致。

进入细化前需要用户确认：默认强度、触发偏好、最大倍率、镜头节奏、是否默认开启和编辑体验。

## 第四阶段：全局提词器与智能跟读

状态：**目标级清单，等待用户进一步细化。**

- [ ] 独立置顶提词器支持 docked、floating、expanded、locked 和点击穿透。
- [ ] 复用 Web 讲稿编辑、双语分词、当前词高亮、匀速滚动和智能跟读。
- [ ] 智能跟读只消费录制会话同一份麦克风 PCM，不二次打开麦克风。
- [ ] 跟读音频只在有界内存缓冲使用，不落盘、不上传。
- [ ] 提词器支持全局快捷键、刘海安全区、多显示器记忆并排除捕获。
- [ ] 识别不可用时明确回退匀速滚动，不阻塞录制。

进入细化前需要用户确认：默认窗口形态、跟读/匀速优先级、暂停策略、字体与高亮表现、快捷键。

## 第五阶段：Director、教学素材与一键成片

状态：**目标级清单，等待用户进一步细化。**

- [ ] Stop 后生成并消费 attention、camera、cleanup、字幕和白板事件。
- [ ] 在录前选定且许可可验证的素材包内选择图表、动效和音效。
- [ ] 所有 AI 结果非破坏、可撤销、可重生成；失败保留原始录制。
- [ ] rough preview 与生成状态真实可见，不用 placement 或 `ready` 字段冒充成片。
- [ ] 用户无需编辑时间线即可得到首版可播放教学视频，完整编辑器仍可选。

进入细化前需要用户确认：自动清理范围、素材风格、声音策略、生成时机、默认是否自动应用。

## 第六阶段：原生预览、导出与长项目

状态：**目标级清单，等待用户进一步细化。**

- [ ] 原生 compositor 消费统一时间映射和全部已启用轨道，输出真实 MP4。
- [ ] Renderer 仅通过 identity/Range/状态访问媒体，不接收本地路径或整段 Blob。
- [ ] 预览、seek、保存和导出使用有界 FD、不可变身份和可取消任务。
- [ ] 屏幕、Camera、mic、system audio、白板、Auto Zoom、字幕和教学素材保持同步。
- [ ] 运行 60 分钟 1440p30 + mic + system audio + 720p camera 真机 soak。
- [ ] 验证 RSS、FD、磁盘、A/V drift、暂停、崩溃恢复和导出性能。

进入细化前需要用户确认：输出格式/质量档、代理媒体策略、导出预设、保存体验和性能目标机型。

## 第七阶段：完整 packaged E2E 与正式发布

状态：**目标级清单，等待用户进一步细化。**

- [ ] 串联冷启动录制条→白板→Camera→Auto Zoom→提词器→Stop→一键成片→保存→重启恢复。
- [ ] 使用真实 packaged Electron、preload、Helper、权限、文件和第三方桌面应用。
- [ ] 登录走系统浏览器 PKCE，session 由 main/Keychain 持有，回到当前录制条。
- [ ] 未签名 DMG 只作为本地阶段预览；不得发布为正式版本。
- [ ] 正式版完成 Developer ID 签名、公证、staple、Gatekeeper、SHA256 和更新签名。
- [ ] 官网下载入口指向固定 Release 资产，并保持 Web build、登录、支付和下载回归通过。

进入细化前需要用户确认：目标发布渠道、最低 macOS、Apple Silicon/Intel 范围、更新策略和正式验收设备。

## 阶段推进规则

- [ ] 每阶段先由用户补充并批准详细规格。
- [ ] 规格写入磁盘并提交后，才创建该阶段实施计划。
- [ ] 每个任务执行 RED→GREEN→复审→commit，不按阶段创建新工作树。
- [ ] 每完成一个可见步骤，运行真实产品并向用户提供截图。
- [ ] 阶段门禁全部通过、用户看过阶段成果后，才自动进入下一阶段的“需求细化”，不得自动实现未批准范围。
