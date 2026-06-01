# Excalicast 上线部署清单（SEO / GEO / Analytics 生效）

> 配套 `docs/marketing-cold-start.md`（渠道运营）与 `docs/demo-video-script.md`（demo 视频）。本清单聚焦「部署后让已写好的 SEO/GEO/埋点真正生效」要做的事，按序勾选。

---

## Block 0. 上线前必须先拍板：域名一致性（阻断项）

**现状不一致，必须先统一再上线：**
- SEO 用 `.cc`：`src/lib/seo/alternates.ts` 的 `SITE_URL = 'https://excalicast.cc'`（canonical / sitemap / hreflang / OG / llms.txt 全部基于它）。CLAUDE.md 与支付 admin API 也用 `excalicast.cc`。
- 落地页 footer 与邮箱用 `.cn`：`src/app/[locale]/page.tsx` footer `© 2026 · excalicast.cn`、`mailto:support@excalicast.cn`；法律页/邮件模板亦多处 `excalicast.cn`。

**为什么是阻断项**：canonical / hreflang / sitemap 必须指向**实际可访问的域名**。若真实站点部署在 `.cn`，但 canonical 全写 `.cc`，搜索引擎会把规范页指向一个不是当前域的地址 → 索引混乱、hreflang 失效、OG 图 404。

**待你确认（二选一）**：
- [ ] **真实生产域名 = `excalicast.cc`** → 把 footer/邮箱/法律页里的 `.cn` 统一改成 `.cc`（我可代改，约 5–8 处文案）。
- [ ] **真实生产域名 = `excalicast.cn`** → 把 `src/lib/seo/alternates.ts` 的 `SITE_URL` 改成 `.cn`（一处，SEO 全链路随之跟正）。

> 在你给出域名前，本项保持不动（不擅自改）。

---

## 1. Vercel 侧配置

- [ ] **开启 Vercel Web Analytics**（项目 → Analytics → Enable）。否则 `<Analytics/>` 的页面浏览**和所有 `track()` 自定义事件都不会上报**。
- [ ] 开启 **Speed Insights**（同页，可选，免费）。
- [ ] 确认生产域名已在 Vercel 绑定且 HTTPS 正常。
- [ ] 确认 `DASHSCOPE_API_KEY` / 支付相关 env / Supabase env 已在生产环境配置（与 SEO 无关，但同批上线检查）。

## 2. 部署后冒烟测试（直接 curl / 浏览器）

- [ ] `https://<域名>/robots.txt` → 200，含 `Sitemap:` 行 + 放行 GPTBot/PerplexityBot/ClaudeBot/Google-Extended。
- [ ] `https://<域名>/sitemap.xml` → 200，含 `/en` 与 `/zh`、各 compare/use-cases/blog 页、每条带 hreflang。
- [ ] `https://<域名>/llms.txt` → 200，价格正确（实时读 payment_config）。
- [ ] 抽查一个内容页（如 `/en/compare/excalicast-vs-loom`）→ 有 `<title>`、`rel=canonical`、FAQ/Breadcrumb JSON-LD、底部「Related」内链。
- [ ] 落地页 `/en` 与 `/zh` → SoftwareApplication + Organization + FAQPage JSON-LD，OG 标签齐全。

## 3. 搜索引擎收录

- [ ] **Google Search Console**：添加资源（推荐「网域」+ DNS TXT 验证）→ 站点地图提交 `https://<域名>/sitemap.xml`。
- [ ] **Bing Webmaster Tools**：可从 GSC 一键导入 → 提交同一 sitemap。（Bing 索引喂给 ChatGPT 联网/Copilot，影响 GEO。）
- [ ] 提交后 2–3 天看 GSC「网页 → 已编入索引」开始爬升；`site:<域名>` 抽查。

## 4. 富结果 / 社交卡片校验

- [ ] **Google Rich Results Test**（search.google.com/test/rich-results）贴 `/en` 与一个对比页 → SoftwareApplication / FAQPage 无错误。
- [ ] **OG 卡片**：opengraph.xyz 或 Twitter Card Validator 贴 `/en`、一个对比页 → 动态 OG 图（1200×630）与标题正确，中英各验一次。

## 5. 转化埋点验证（部署后滞后可见）

在站内点几次后，去 **Vercel Analytics → Events** 确认出现：
- [ ] `cta_start_recording`（落地页 nav/hero）
- [ ] `pricing_cta_click`（四档卡片）
- [ ] `content_cta_click`（对比/场景页底部 CTA）
- [ ] `feature_click`（导出/字幕/讲义/分享，带 `gated`）
- [ ] `checkout_start` / `purchase_success`（走一笔测试支付，建议先切 Creem test 模式，见 CLAUDE.md「切换 live ↔ test」）

## 6. GEO 抽测（上线 1–2 周后，滞后指标）

- [ ] Perplexity / ChatGPT(联网) 问：「Loom alternative for whiteboard」「record excalidraw to video」「export one whiteboard recording to 16:9 and 9:16」→ 看是否出现/引用 `<域名>`。
- [ ] 去 **AlternativeTo / SaaSHub / Product Hunt** 建免费产品条目（AI 回答「X 替代品」的高频引用源）。

---

## 一句话
先定死域名（block 0）→ Vercel 开 Analytics → 部署 → curl 冒烟 → GSC/Bing 交 sitemap → 富结果/OG 校验 → 看埋点事件 → 1–2 周后 GEO 抽测。
