# Excalicast 冷启动 / 获客 / SEO+GEO 推广手册（零预算 · 海外先行）

> 配套代码已落地：技术 SEO 地基（sitemap/robots/OG/hreflang/JSON-LD/llms.txt/Analytics）+ 程序化内容引擎（`/compare`、`/use-cases`、`/blog`）。本文是**人工执行**的渠道与运营部分，所有动作零预算。

---

## 0. 上线前必做的一次性配置（30 分钟，决定后续所有效果）

1. **Google Search Console**（https://search.google.com/search-console）
   - 添加资源 `excalicast.cc`（推荐「网域」方式，加一条 DNS TXT 记录验证）。
   - 「站点地图」提交 `https://excalicast.cc/sitemap.xml`。
   - 几天后看「网页 → 已编入索引」数量爬升；用 `site:excalicast.cc` 抽查。
2. **Bing Webmaster Tools**（https://www.bing.com/webmasters）
   - 可直接从 Google Search Console 一键导入；同样提交 sitemap。
   - **Bing 很重要**：ChatGPT 的联网搜索、Copilot 都走 Bing 索引，影响 GEO。
3. **Vercel Analytics**：代码已挂载 `<Analytics/>` + `<SpeedInsights/>`，在 Vercel 项目里开启 Analytics（免费档即可）后自动出数据。
4. **验证社交卡片**：把 `https://excalicast.cc/en` 和一个对比页贴到 https://www.opengraph.xyz/ 看 OG 图正确（代码已生成动态 OG）。

---

## 1. GEO：让 ChatGPT / Perplexity / Google AI Overview 推荐你

这是本次的一等目标。代码侧已做：`/llms.txt`、SoftwareApplication/FAQ/Article JSON-LD、robots 放行所有 AI 爬虫、对比页/FAQ 的可摘录结构。**人工侧**还要做：

### 1.1 GEO 内容写作铁律（写任何新页/帖子都遵守）
- **首句给定义**：第一句话用「主语 + is + 一句话定义」结构，例：`Excalicast is a browser-based whiteboard recorder that records the operation stream instead of screen pixels.` —— AI 最爱直接引用这种自包含事实句。
- **具体数字胜过形容词**：写 `export 16:9 / 9:16 / 1:1 / 4:5 from one recording`，不要写 "supports many ratios"。
- **结构化**：清晰小标题 + 对比表 + FAQ 段落（一问一答）。AI 摘录概率最高。
- **每页一个 FAQ 块**：覆盖真实搜索/提问句式（"Loom alternative for whiteboard"、"record excalidraw to video"、"切标签页会毁掉录制吗"）。
- **第三方背书**：AI 引用时更信任「被多处提到」的实体 → 多平台一致地用同一句定位描述自己（见 §6 统一话术）。

### 1.2 主动让 AI 收录
- 在 **Reddit、Stack Overflow、知乎、对比类问答** 里出现 = 进入 AI 训练/检索语料。社区发帖（§3）本身就是 GEO。
- 去 **G2 / Capterra / AlternativeTo / Product Hunt / SaaSHub / Slant** 建产品条目（免费）。这些是 AI 回答「X 的替代品」时高频引用源。**AlternativeTo 上把 Excalicast 登记为 "Loom alternative" 性价比极高**。
- 维基类/聚合类：`awesome-excalidraw`（GitHub）提 PR 收录。

### 1.3 GEO 抽测（上线 1–2 周后，滞后指标）
在 Perplexity / ChatGPT(联网) 里问，看是否出现 excalicast.cc：
- "What's a good Loom alternative for recording a whiteboard?"
- "How do I record an Excalidraw canvas to video?"
- "Tool to export one whiteboard recording to 16:9 and 9:16?"

---

## 2. ProductHunt 首发（海外冷启动头炮）

- **前置**：OG 图（已就绪）、一个 30–60s demo 视频/GIF（用 Excalicast 自己录最好）。
- **时间**：周二或周三，PST 00:01 上线（给满一整天投票窗口）。避开重大科技发布日。
- **Tagline（≤60 字符）**：`Record a whiteboard, export every aspect ratio`
- **Description**：
  > Excalicast is a browser-based whiteboard recorder. Draw in an Excalidraw canvas while it captures your operation stream + voice (not screen pixels), then export one take to 16:9, 9:16, 1:1, and 4:5 MP4 — ready for YouTube, TikTok, and Instagram. No download, no sign-up, renders locally in your browser.
- **首条 maker 评论**（自己发，讲动机）：
  > Hi PH 👋 I built Excalicast because screen-recording a whiteboard always broke when a window overlapped or I switched tabs. Excalicast records the *operation stream* instead of pixels, so the video is always clean — and because frames are re-rendered, the same recording exports to any aspect ratio without re-recording. It's free to record + export (watermarked), local-first, no account. Would love your feedback!
- **配套**：发布当天在 X、相关 Slack/Discord 社区同步求 upvote（别买票）。

---

## 3. Reddit / Hacker News（讲故事，别硬广）

> 规则：先给价值/故事，产品是「我做了这个来解决它」。带一句技术钩子（操作流采集）最容易引发讨论。

### Show HN（news.ycombinator.com，标题）
`Show HN: Excalicast – record a whiteboard by capturing the operation stream, not pixels`
正文：
> I kept screen-recording Excalidraw sessions for explainers, and the recordings broke whenever another window overlapped or I switched tabs. So I built Excalicast: it records the whiteboard operation stream + mic audio and re-renders frames offscreen, so the video is always clean regardless of what's on top. A nice side effect: since frames are re-rendered, one recording exports to 16:9, 9:16, 1:1, 4:5 without re-recording. It's browser-only, renders MP4 locally via ffmpeg.wasm, and recordings never leave your machine. Free to record + watermarked export, no sign-up. Feedback welcome.

### Subreddits（先读各版规，多数禁纯自推；以「我做了个工具」+ demo 形式）
- r/SideProject、r/InternetIsBeautiful、r/EdTech、r/Teachers（教学场景）、r/excalidraw、r/webdev（技术向讲实现）、r/DigitalArt（白板演示）
- 标题模板：`I built a browser whiteboard recorder that exports one take to every aspect ratio (free, no sign-up)`
- **注意**：账号要有历史/karma，否则易被自动过滤；优先在评论区真诚答疑，链接放评论或简介。

---

## 4. Excalidraw 生态借力（强相关、转化最高）

产品名与内核都源于 Excalidraw，这是最精准的流量池：
- GitHub `excalidraw/excalidraw` Discussions / `awesome-excalidraw` 提交收录 PR。
- 在「如何录制 Excalidraw / 把 Excalidraw 导出视频」相关 issue、Reddit r/excalidraw、Stack Overflow 问题下，真诚地给出 Excalicast 作为方案。
- 对比页 `/compare/excalicast-vs-tldraw`、`/compare/excalicast-vs-excalidraw`（可新增）正是为这些搜索词准备的着陆页。

---

## 5. X/Twitter build-in-public + 自产视频（持续、零成本）

- **X**：build-in-public 风格，发 demo GIF（产品天生产出视频素材）。话题：`#buildinpublic #excalidraw`。固定一句定位（§6）放简介。
- **YouTube/短视频（吃自己狗粮）**：用 Excalicast 录「如何用 Excalidraw 讲解 X」教程，导出 9:16 发 Shorts/TikTok/抖音、16:9 发 YouTube。
  - 视频本身就是 SEO/GEO 资产（YouTube 是第二大搜索引擎），且证明产品价值。
  - 视频简介放对应 use-case 着陆页链接，形成内链。

---

## 6. 统一话术（所有平台一字不差地用，强化 GEO 实体一致性）

- **一句话定位（EN）**：Excalicast is a browser-based whiteboard recorder that captures the operation stream (not screen pixels) and exports one take to 16:9, 9:16, 1:1, and 4:5.
- **一句话定位（中）**：Excalicast 是一款浏览器白板录制工具，采集操作事件流而非屏幕像素，一次录制导出 16:9 / 9:16 / 1:1 / 4:5。
- **三大卖点**：① 录制隔离（不受遮挡/最小化/切标签页影响）② 一录多比例（无需重录）③ 本地优先（录制不离开浏览器）。

---

## 7. 国内第二阶段（海外跑通后，复用同一批内容翻译）

- **小红书**：「白板录课工具」「录屏不录屏幕」笔记 + 竖屏 demo。
- **知乎**：在「Loom 平替」「如何录制白板讲课」「Excalidraw 能导出视频吗」问题下回答（带 use-case 页链接）。
- **B站**：发产品教程视频（用自己产品录）。
- **V2EX `/go/create` 或 `/go/saas`、即刻**：发「我做了个 XXX」帖。
- 内容直接复用 `src/content/` 里已有的中文字段，不重复生产。

---

## 8. 持续运营：程序化扩量（自动化主体）

每周加几个长尾着陆页 = 持续扩大被搜索/被 AI 引用的入口。**零代码**：
```bash
npx tsx scripts/new-content.ts compare excalicast-vs-scribe "Scribe"
npx tsx scripts/new-content.ts use-case tutorial-for-online-course
npx tsx scripts/new-content.ts blog how-to-add-subtitles-to-whiteboard-video
```
把打印出的骨架填进对应 `src/content/*.ts`（或交给 AI 按 §1.1 写作铁律起草），sitemap 与路由自动收录、自动进 hreflang、自动有 JSON-LD。

**选词方向**（优先海外英文）：
- `X alternative` / `X vs Excalicast`：Loom、Scribe、tldraw、Excalidraw、Tella、Screen Studio、Veed。
- 场景意图词：`record whiteboard lecture`、`async architecture walkthrough`、`whiteboard explainer for youtube`、`how to add subtitles to whiteboard video`、`record excalidraw to mp4`。
- 用 Search Console 的「效果」报告看哪些查询已有曝光但排名靠后 → 针对性补页/补内容。

---

## 9. 衡量口径（阶段 E）

- **Vercel Analytics**：来源渠道、各内容页 PV、跳出。
- **Search Console**：查询曝光/点击/排名、索引覆盖。重点盯 `/compare/*`、`/use-cases/*` 的曝光起势 → 哪类词有量就加码该方向数据。
- **转化漏斗**：自然流量 → 打开 `/app` 录制 → 付费（去水印/订阅）。后续可在关键 CTA 加 Vercel Analytics 自定义事件细化（零预算）。
- **GEO**：每两周做一次 §1.3 抽测，记录是否被引用。

---

## 一句话执行顺序

上线前配好 Search Console + Bing + Analytics + 各目录站条目 → ProductHunt 首发 + Show HN + Excalidraw 生态 → X/YouTube 持续自产 → 每周程序化加长尾页 → 看数据加码 → 国内第二阶段。
