# Excalicast Demo 视频：业界做法 + 可直接拍的脚本

> 配套 `docs/marketing-cold-start.md`。ProductHunt 首发、落地页 Hero、YouTube/Shorts 都需要一条 demo 视频。本文先讲业界怎么生成推广 demo 视频（工具地图），再给可直接拍的中英双语脚本。

---

## 一、业界一般用什么生成网站推广 demo 视频

SaaS 推广 demo 视频通常分四类工具，按「录屏精修 → 配音/数字人 → 交互式演示 → 动效字幕」组合使用。

### 1. 录屏 + 自动精修（最主流，做产品演示画面）
| 工具 | 平台 | 特点 | 适用 |
|------|------|------|------|
| **Screen Studio** | macOS | 自动放大点击点、平滑光标、自动缩放、生成竖屏 —— **当前 SaaS demo 事实标准** | 落地页/PH 首图视频 |
| **Tella** | 浏览器 | 屏幕+摄像头、样式背景、多片段拼接 | 出镜讲解短片 |
| **Loom** | 跨平台 | 快速录、自动转写、即时分享 | 内部演示、初稿 |
| **CapCut / 剪映** | 跨平台 | 免费、自动字幕、模板、转场 | 短视频剪辑+字幕 |
| **Veed** | 浏览器 | 在线录+剪+字幕+模板 | 一站式轻剪辑 |

### 2. AI 配音 / 数字人（不想露脸/不想自己配音时）
- **ElevenLabs**：高质量 AI 旁白配音（中英多语），是目前独立开发者做 demo 旁白的首选。
- **Descript**：转录式剪辑 —— 像编辑文档一样剪视频，自动去「嗯/啊」口水词，内置 AI 配音（Overdub）。**强烈推荐**：录完用它快速精修 + 配音。
- **Synthesia / HeyGen**：数字人口播（虚拟主播念稿），适合要「人脸讲解」但不想真人出镜。

### 3. 交互式产品演示（嵌落地页，点选式 walkthrough，非视频但同属 demo）
- **Arcade / Supademo / Storylane**：把产品操作录成可点击的交互演示，嵌在落地页 Hero 或 ProductHunt。转化往往高于纯视频（用户能自己点）。**值得在落地页放一个**。

### 4. 动效 / 字幕 / 封面
- **Jitter**：轻量动效（标题入场、强调）。
- **After Effects**：重度动效（一般用不上）。
- **CapCut 自动字幕**：竖屏短视频必备（社交平台 80% 静音观看）。

### 推荐组合（独立开发者 / 零预算友好）
1. **吃自己狗粮**：核心白板演示画面**直接用 Excalicast 自己录**（这本身就是最好的产品证明，且是 SEO/GEO 资产）。
2. 外层屏幕操作（点按钮、切比例）用 **Screen Studio**（Mac）或 **CapCut**（免费）录制精修。
3. 旁白用 **ElevenLabs** 配音，或 **Descript** 录完去口水词。
4. 字幕用 **CapCut 自动字幕**（竖屏版必加）。
5. 落地页额外放一个 **Arcade/Supademo** 交互演示。

---

## 二、主脚本（45–60s，横屏 16:9，落地页 Hero + ProductHunt + YouTube）

> 结构：痛点钩子 → 解法（核心差异化）→ 一录多比例 → 隐私/免费 → CTA。每个分镜给【画面】【旁白 VO】【屏幕字幕】。旁白中英双语，按目标市场二选一录制（海外先行=英文）。

| # | 时长 | 画面 | 旁白 VO（EN / 中） | 屏幕字幕 |
|---|------|------|---------------------|----------|
| 1 | 0–6s | 一段普通录屏：白板讲到一半，弹出微信窗口挡住画面 / 浏览器最小化变黑屏 | "Screen-recording a whiteboard? One overlapping window and your video is ruined." / 「录屏讲白板？一个窗口挡上来，视频就毁了。」 | ❌ Screen recording breaks |
| 2 | 6–16s | 切到 Excalicast：在 Excalidraw 画布上边画边讲，**故意切到另一个标签页再切回**，画面始终是干净白板 | "Excalicast records the operation stream, not screen pixels. Switch tabs, get a notification — the recording stays clean." / 「Excalicast 录的是操作事件流，不是屏幕像素。切标签页、来通知，录制始终干净。」 | ✅ Records the operation stream |
| 3 | 16–28s | 导出面板：同一段录制，点 16:9 预览 → 一键切 9:16 竖屏 → 1:1，三个比例缩略图并排 | "One recording exports to 16:9, 9:16, 1:1, and 4:5 — no re-recording. Ship to YouTube, TikTok, and Instagram from one take." / 「同一段录制导出 16:9、9:16、1:1、4:5，无需重录。一次录制，发 YouTube、抖音、Instagram。」 | One take · every ratio |
| 4 | 28–38s | 摄像头气泡叠加演示 + 角落小字 "renders in your browser" + 一个锁图标→打开 | "Optional camera bubble. Everything renders locally in your browser — your recordings never leave your computer." / 「可选人像气泡。全部在浏览器本地渲染——录制内容从不离开你的电脑。」 | Local-first · private |
| 5 | 38–48s | 落地页 Hero，光标点 "Start free"，强调 "no sign-up" | "Free to record and export. No download, no sign-up. Try it now." / 「录制和导出免费，无需下载、无需注册。现在就试。」 | excalicast.cc |
| 6 | 48–52s | Logo + 域名定格 + 红色 REC 点 | （静音或轻音效） | **excalicast.cc** |

**关键拍摄要点**
- 分镜 2 的「切标签页画面不脏」是**核心卖点**，要拍得明显（让观众看到切走又切回，白板纹丝不动）。
- 分镜 3 的「一键切比例」要快、要有并排对比，制造「一录多发」的爽感。
- 全程无需真人出镜；旁白可 ElevenLabs 配。
- 背景音乐选轻快 lo-fi，音量压低不盖旁白。

---

## 三、短版脚本（12–15s，竖屏 9:16，Shorts / Reels / TikTok / 抖音）

> 社交平台前 2 秒定生死，开头直接抛冲突。

| # | 时长 | 画面 | 旁白/字幕（EN / 中） |
|---|------|------|----------------------|
| 1 | 0–3s | 录屏被弹窗挡住的瞬间，大字 | "Stop screen-recording your whiteboard." / 「别再录屏讲白板了。」 |
| 2 | 3–8s | Excalicast 干净录制 + 切标签页不脏 | "It records the actions, not the screen." / 「它录的是操作，不是屏幕。」 |
| 3 | 8–12s | 16:9 → 9:16 一键切换 | "One take → every aspect ratio." / 「一次录制 → 每种比例。」 |
| 4 | 12–15s | 域名定格 | "Free, no sign-up. excalicast.cc" / 「免费免注册 · excalicast.cc」 |

**注意**：竖屏版务必加**烧录字幕**（CapCut 自动字幕），因为多数人静音刷。

---

## 四、产物去向（一鱼多吃）
- 主版（16:9）→ 落地页 Hero、ProductHunt 首图视频、YouTube。
- 短版（9:16）→ Shorts / Reels / TikTok / 抖音 / 小红书。
- 交互式（Arcade/Supademo）→ 落地页内嵌、ProductHunt 评论区。
- 每条视频简介放对应 use-case 着陆页链接（`/use-cases/record-whiteboard-lecture` 等），形成内链 + 把社交流量导回站内，强化 SEO/GEO。
