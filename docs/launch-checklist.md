# Excalicast 上线部署清单（SEO / GEO / Analytics 生效）

> 配套 `docs/marketing-cold-start.md`（渠道运营）与 `docs/demo-video-script.md`（demo 视频）。本清单聚焦「部署后让已写好的 SEO/GEO/埋点真正生效」要做的事，按序勾选。

---

## Block 0. 域名约定（已确认，见 CLAUDE.md「域名约定」）

- **站点 / canonical / sitemap / OG / IndexNow 域名 = `excalicast.cc`**（实测线上跑在 .cc，`SITE_URL` 正确）。
- **客服邮箱 = `support@excalicast.cn`（`.cn` 故意，勿改）**；footer/法律页/邮件里的 `.cn` 保持不动。
- 无需任何域名改动，可直接进入下面步骤。

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

## 7. IndexNow（加速 Bing / Yandex / Seznam / Naver 收录）

IndexNow 让你主动把 URL 推给 Bing 等引擎，新站收录比干等自然爬取快得多。（Google 不正式消费 IndexNow，Google 侧靠 §3 的请求编入索引 + 外链。）

- [ ] 部署后确认密钥文件可达：`curl https://excalicast.cc/e0db09f0b1ee71fc3abbf04e5909381f.txt` → 返回该 key 本身（200, text/plain）。**必须先可达**，否则 IndexNow 校验失败。
- [ ] 跑提交脚本：`npx tsx scripts/indexnow.ts`（先 `--dry-run` 看 URL 列表）。返回 `200`/`202` 即受理。
- [ ] Bing Webmaster →「IndexNow」面板可看到提交记录与处理状态。
- [ ] **每次部署 / 新增内容页后重跑** `npx tsx scripts/indexnow.ts`。

## 8. 新站收录预期（管理预期，别焦虑）

- 刚提交 sitemap / inspection 时，GSC 常见「已发现-尚未编入索引」「重复网页-未选定规范网页」「网页会自动重定向（指 `/` 或带尾斜杠的 `/en/`）」，Bing 常见「known but has issues」——**这些多为新域名初次索引的正常瞬时态，不是 bug**（markup 实测正确）。
- 收录通常需 **数天~数周**；最大加速杠杆是**外链信号**（ProductHunt/Show HN/AlternativeTo 一上，收录明显变快）+ GSC 手动「请求编入索引」+ IndexNow（Bing）。
- 复查节奏：1 周看 Bing、2–3 周看 Google；别反复删了重交 sitemap（会重置）。

---

## 一句话
Vercel 开 Analytics → 部署 → curl 冒烟（含 IndexNow key 文件）→ GSC/Bing 交 sitemap → 跑 `indexnow.ts` → 富结果/OG 校验 → GSC 请求编入索引 + 上外链 → 1–3 周复查收录 + GEO 抽测。
