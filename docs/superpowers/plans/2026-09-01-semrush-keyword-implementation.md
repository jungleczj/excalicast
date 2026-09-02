# SEMrush 关键词与内容集群实施计划

**目标：** 按美国数据库筛出 `Volume >= 1,000`、`KD < 50%`、`Competition < 0.5` 的产品相关词，转成不会互相内耗的 Excalicast 页面，并保留可复核的数据与发布检查。

**基线：** 用户给出的 `8399ef3 feat: adapt english dubbing timeline and key points` 在当前本地对象库不可解析；实施基于当前干净分支 `fix/loading-recording`，不改录制、导出、支付或数据流。

## 交付

- [x] 在 SEMrush Keyword Overview 中批量筛选美国关键词。
- [x] 建立默认列表 `Excalicast SEO Opportunities Sep 2026` 并加入 8 个合格词。
- [x] 研究 YouTube 视频 `Claude Code SEO: How I Got 50,000 Clicks Per Month (Steal This)` 的完整转写与章节。
- [x] 抽样 16 个头部录屏、白板与动画工具的自然词和主要页面。
- [x] 抽样 Loom 外链概览、锚文本、链接属性和引荐域名类别。
- [x] 为每个合格词记录非 Reddit Top 3 的结构模板。
- [x] 把 8 个词聚成 4 页，避免近义词自相竞争。
- [x] 为新内容增加可执行约束测试。
- [ ] 上线后提交 sitemap，并在 GSC/SEMrush Position Tracking 中建立基线。
- [ ] 28 天后按 impressions、Top 20 数量、CTR、内容 CTA 点击复盘。

## 页面映射

| 主页面 | 主词 | 同页次词 | 原因 |
|---|---|---|---|
| `/blog/how-to-screen-record-on-windows-11` | how to screen record on pc | screen recorder windows 11; record screen windows 11 | 搜索意图与 SERP 高度重合，拆页会内耗 |
| `/blog/screencasting-guide` | screencasting | screencast workflow; screencasting examples | 定义型信息词，适合主题支柱 |
| `/blog/best-screen-recorder-for-mac` | screen recorder for mac | mac screen recorder; screen recording on mac | 商业调查与教程混合意图 |
| `/blog/whiteboard-animation-and-hand-drawn-explainers` | whiteboard animation | animated explainer video; hand drawn animation | 先解释边界，再承接白板讲解产品能力 |

## 验证

- 关键词测试：每个词只属于一个页面集群；每页至少 5 个正文块与 3 个 FAQ。
- 路由测试：新博客自动进入双语 sitemap。
- 静态验证：`npm run typecheck`、目标 Playwright SEO 测试、`npm run build`。
- 发布后验证：URL Inspection、canonical/hreflang、富结果、CWV、Position Tracking。
