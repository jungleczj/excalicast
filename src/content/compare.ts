import type { CompareEntry } from './types';

const END_TO_END_WORKFLOW = [
  {
    title: { en: 'Capture the right source', zh: '采集正确的来源' },
    body: {
      en: 'Record the Excalidraw whiteboard, a browser tab, an app window, or the entire desktop with microphone and optional camera.',
      zh: '录制 Excalidraw 白板、浏览器标签页、应用窗口或整个桌面，并同步采集麦克风与可选摄像头。',
    },
  },
  {
    title: { en: 'Edit in the browser', zh: '在浏览器内剪辑' },
    body: {
      en: 'Trim, split, delete, and review the recording on the timeline instead of moving the file into a separate desktop editor.',
      zh: '在时间线上裁剪、分割、删除和检查录制，无需把文件转移到另一个桌面剪辑器。',
    },
  },
  {
    title: { en: 'Refine attention and supporting assets', zh: '优化观看焦点与配套资产' },
    body: {
      en: 'Apply ChatCut-assisted edits, adjust Autozoom focus regions, and generate eligible captions, chapters, and handouts.',
      zh: '使用 ChatCut 辅助剪辑、调整 Autozoom 焦点区域，并按权益生成字幕、章节与讲义。',
    },
  },
  {
    title: { en: 'Create publish-ready outputs', zh: '生成发布就绪成品' },
    body: {
      en: 'Render landscape, portrait, square, feed, or custom files from the recording, then download them or create an eligible share link.',
      zh: '从同一录制渲染横屏、竖屏、方形、信息流或自定义文件，再下载成品或按权益创建分享链接。',
    },
  },
];

/**
 * Comparison landing pages. Each targets "X alternative" / "X vs Excalicast"
 * search + AI queries. Keep claims factual and specific — generative engines
 * preferentially cite concrete, verifiable statements.
 */
export const COMPARE_ENTRIES: CompareEntry[] = [
  {
    slug: 'excalicast-vs-loom',
    competitor: 'Loom',
    title: {
      en: 'Excalicast vs Loom: whiteboard video recorder',
      zh: 'Excalicast vs Loom：白板录制工具替代方案',
    },
    description: {
      en: 'Compare Loom and Excalicast for whiteboard videos, local recording, subtitles, and multi-ratio MP4 export from one take.',
      zh: 'Loom 录制屏幕像素，Excalicast 录制白板操作事件流，一次录制导出 16:9 / 9:16 / 1:1 / 4:5。对比功能与定价。',
    },
    intro: {
      en: 'Excalicast is a browser-based whiteboard recorder and a Loom alternative for whiteboard explainers: instead of capturing screen pixels, it records the Excalidraw operation stream plus microphone audio, so recordings are never affected by window occlusion or minimization and the same take exports to multiple aspect ratios.',
      zh: 'Excalicast 是一款浏览器白板录制工具，也是白板讲解场景下的 Loom 替代方案：它采集的是 Excalidraw 操作事件流 + 麦克风音频，而非屏幕像素，因此录制完全不受窗口遮挡或最小化影响，同一段录制可导出多种比例。',
    },
    directAnswer: {
      en: 'Loom is a general screen recorder. Excalicast is better for whiteboard videos when you need local recording, clean diagram capture, subtitles, and multi-ratio export.',
      zh: 'Loom 是通用屏幕录制工具。需要本地录制、清晰图解采集、字幕和多比例导出白板视频时，Excalicast 更合适。',
    },
    bestFor: [
      {
        en: 'Loom fits quick screen-share updates, async team messages, and general app walkthroughs.',
        zh: 'Loom 适合快速屏幕分享、异步团队消息和通用应用演示。',
      },
      {
        en: 'Excalicast fits whiteboard lessons, Excalidraw-style diagram explainers, and publish-ready teaching videos.',
        zh: 'Excalicast 适合白板课程、类似 Excalidraw 的图解讲解，以及可发布的教学视频。',
      },
    ],
    notBestFor: [
      {
        en: 'Loom is not optimized for one-take whiteboard videos that need several social aspect ratios from the same source.',
        zh: 'Loom 不专门面向同一白板录制一键导出多种社媒比例的工作流。',
      },
      {
        en: 'Excalicast is not a full team video-messaging workspace like Loom.',
        zh: 'Excalicast 不是 Loom 那样完整的团队视频消息工作区。',
      },
    ],
    facts: [
      {
        label: { en: 'Excalicast primary workflow', zh: 'Excalicast 主要流程' },
        value: {
          en: 'Record a whiteboard, tab, window, desktop, or selected area, then edit and export MP4 in the browser.',
          zh: '录制白板、标签页、窗口、桌面或选区，然后在浏览器内编辑并导出 MP4。',
        },
      },
      {
        label: { en: 'Loom public positioning', zh: 'Loom 公开定位' },
        value: {
          en: 'Loom publicly positions itself around screen recording and async video messaging.',
          zh: 'Loom 公开定位围绕屏幕录制和异步视频消息。',
        },
      },
    ],
    sources: [
      { label: { en: 'Loom official website', zh: 'Loom 官网' }, url: 'https://www.loom.com/' },
      { label: { en: 'Excalicast pricing and product page', zh: 'Excalicast 产品与定价页' }, url: 'https://excalicast.cc/en/pricing' },
    ],
    verifiedAt: '2026-08-18',
    ctaPreset: {
      label: { en: 'Record a whiteboard video', zh: '免费录制白板视频' },
      href: '/app?intent=whiteboard-video',
    },
    rows: [
      {
        feature: { en: 'Capture method', zh: '采集方式' },
        excalicast: { en: 'Whiteboard operation stream', zh: '白板操作事件流' },
        competitor: { en: 'Screen pixels', zh: '屏幕像素' },
      },
      {
        feature: { en: 'Window occlusion / minimize', zh: '窗口遮挡 / 最小化' },
        excalicast: { en: 'Unaffected — always crisp', zh: '不受影响，始终清晰' },
        competitor: { en: 'Records the occluding window', zh: '录到遮挡窗口' },
      },
      {
        feature: { en: 'Aspect ratios from one take', zh: '一次录制的比例' },
        excalicast: { en: '16:9, 9:16, 1:1, 4:5 — no re-record', zh: '16:9/9:16/1:1/4:5，无需重录' },
        competitor: { en: 'Fixed; re-record needed', zh: '固定，需重录' },
      },
      {
        feature: { en: 'Where recordings are stored', zh: '录制存储位置' },
        excalicast: { en: 'Local browser (IndexedDB)', zh: '浏览器本地（IndexedDB）' },
        competitor: { en: 'Uploaded to cloud', zh: '上传到云端' },
      },
      {
        feature: { en: 'Sign-up to start', zh: '开始是否需注册' },
        excalicast: { en: 'Not required', zh: '不需要' },
        competitor: { en: 'Required', zh: '需要' },
      },
      {
        feature: { en: 'Auto subtitles', zh: '自动字幕' },
        excalicast: { en: 'Alibaba Qwen ASR (Pro)', zh: '阿里千问 ASR（Pro）' },
        competitor: { en: 'Included on paid plans', zh: '付费档包含' },
      },
    ],
    verdict: {
      en: 'Choose Loom for general screen recording across any app. Choose Excalicast when your content is a whiteboard or diagram explainer: you get occlusion-proof capture, multi-ratio export from a single take, local-first privacy, and a free watermarked tier with no sign-up.',
      zh: '如果你要录制任意应用的通用屏幕，选 Loom；如果你的内容是白板 / 图解讲解，选 Excalicast：抗遮挡采集、一次录制多比例导出、本地优先的隐私，以及无需注册的免费（带水印）档。',
    },
    faqs: [
      {
        q: { en: 'Is Excalicast a free Loom alternative?', zh: 'Excalicast 是免费的 Loom 替代品吗？' },
        a: {
          en: 'Recording and watermarked MP4 export are free with no account. Watermark-free export is a one-time payment per recording, and Pro/Max add subtitles, cloud backup, AI handouts, and share links.',
          zh: '录制和导出带水印的 MP4 免费、无需账号。无水印导出按录制单次付费，Pro/Max 额外提供字幕、云端备份、AI 讲义和分享链接。',
        },
      },
      {
        q: { en: 'Can I export a vertical 9:16 video for TikTok from a whiteboard recording?', zh: '能把白板录制导出成 9:16 竖屏发抖音/TikTok 吗？' },
        a: {
          en: 'Yes. A single Excalicast recording exports to 16:9, 9:16, 1:1, and 4:5 without re-recording, so you can ship one take to YouTube, TikTok, and Instagram.',
          zh: '可以。同一段 Excalicast 录制可导出 16:9 / 9:16 / 1:1 / 4:5，无需重录，一次录制即可投 YouTube、抖音、Instagram。',
        },
      },
    ],
    related: [
      { type: 'blog', slug: 'loom-alternatives-for-whiteboard' },
      { type: 'compare', slug: 'excalicast-vs-screen-recording' },
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-tldraw',
    competitor: 'tldraw',
    title: {
      en: 'Excalicast vs tldraw: recording a whiteboard to video',
      zh: 'Excalicast vs tldraw：把白板录成视频',
    },
    description: {
      en: 'tldraw is a whiteboard canvas; Excalicast is a whiteboard recorder built on Excalidraw that captures voice + actions and exports MP4 in multiple aspect ratios.',
      zh: 'tldraw 是白板画布，Excalicast 是基于 Excalidraw 的白板录制工具，采集语音 + 操作并导出多比例 MP4。',
    },
    intro: {
      en: 'tldraw and Excalidraw are infinite-canvas whiteboards for drawing; Excalicast adds the recording layer on top of an Excalidraw canvas — it captures your operation stream and microphone audio and renders a narrated MP4 in 16:9, 9:16, 1:1, or 4:5 entirely in the browser.',
      zh: 'tldraw 和 Excalidraw 都是用于作画的无限画布白板；Excalicast 在 Excalidraw 画布之上加了录制层——采集操作事件流和麦克风音频，并在浏览器内渲染出带旁白的 16:9 / 9:16 / 1:1 / 4:5 MP4。',
    },
    rows: [
      {
        feature: { en: 'Primary purpose', zh: '主要用途' },
        excalicast: { en: 'Record a whiteboard to narrated video', zh: '把白板录成带旁白的视频' },
        competitor: { en: 'Draw / collaborate on a canvas', zh: '在画布上作画 / 协作' },
      },
      {
        feature: { en: 'Built-in voice + action recording', zh: '内置语音 + 操作录制' },
        excalicast: { en: 'Yes', zh: '有' },
        competitor: { en: 'No', zh: '无' },
      },
      {
        feature: { en: 'MP4 export with audio', zh: '带音轨的 MP4 导出' },
        excalicast: { en: 'Yes, in-browser (ffmpeg.wasm)', zh: '有，浏览器内（ffmpeg.wasm）' },
        competitor: { en: 'No', zh: '无' },
      },
      {
        feature: { en: 'Multi aspect-ratio export', zh: '多比例导出' },
        excalicast: { en: '16:9 / 9:16 / 1:1 / 4:5', zh: '16:9 / 9:16 / 1:1 / 4:5' },
        competitor: { en: 'N/A', zh: '不适用' },
      },
    ],
    verdict: {
      en: 'Use tldraw when you just need a canvas to draw or collaborate. Use Excalicast when the deliverable is a video: it records the canvas session with synchronized voice and exports a shareable MP4 without any screen-recording software.',
      zh: '只需要一块画布作画 / 协作时用 tldraw；当交付物是视频时用 Excalicast：它带同步语音录制画布过程，并导出可分享的 MP4，无需任何录屏软件。',
    },
    faqs: [
      {
        q: { en: 'Can tldraw record a video?', zh: 'tldraw 能录视频吗？' },
        a: {
          en: 'tldraw itself is a drawing canvas and does not record narrated video. Excalicast is purpose-built for that: it captures the operation stream plus audio and exports an MP4.',
          zh: 'tldraw 本身是作画画布，不录制带旁白的视频。Excalicast 专为此而生：采集操作事件流 + 音频并导出 MP4。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-screen-recording',
    competitor: 'Screen recording',
    title: {
      en: 'Excalicast vs screen recording: why operation-stream capture wins for whiteboards',
      zh: 'Excalicast vs 录屏：白板场景为什么操作流采集更好',
    },
    description: {
      en: 'Screen recorders capture pixels and break on occlusion or minimization. Excalicast records the whiteboard operation stream for always-crisp, multi-ratio video.',
      zh: '录屏工具采集像素，遇遮挡或最小化就出问题。Excalicast 录制白板操作事件流，画面始终清晰、可多比例导出。',
    },
    intro: {
      en: 'Traditional screen recording (getDisplayMedia / OS screen capture) records whatever is painted on screen, so an overlapping window, a minimized browser, or a tab switch ends up in the video. Excalicast instead records the whiteboard operation stream and re-renders frames offscreen, so the exported video always shows clean whiteboard content regardless of what is in front of it.',
      zh: '传统录屏（getDisplayMedia / 系统屏幕捕获）录的是屏幕上画出来的任何东西，所以遮挡窗口、最小化的浏览器或切标签页都会被录进视频。Excalicast 录的是白板操作事件流并在离屏重新渲染每一帧，因此导出的视频始终是干净的白板内容，与前面挡着什么无关。',
    },
    rows: [
      {
        feature: { en: 'What gets recorded', zh: '录到的内容' },
        excalicast: { en: 'Whiteboard content only', zh: '只有白板内容' },
        competitor: { en: 'Everything on screen', zh: '屏幕上的一切' },
      },
      {
        feature: { en: 'Overlapping window / notification', zh: '遮挡窗口 / 通知弹窗' },
        excalicast: { en: 'Not captured', zh: '不会录进去' },
        competitor: { en: 'Captured into the video', zh: '会录进视频' },
      },
      {
        feature: { en: 'Re-frame to another ratio later', zh: '事后改成另一比例' },
        excalicast: { en: 'Re-render at any ratio', zh: '可任意比例重渲染' },
        competitor: { en: 'Locked to capture resolution', zh: '锁死在采集分辨率' },
      },
      {
        feature: { en: 'Privacy', zh: '隐私' },
        excalicast: { en: 'Renders locally, no upload', zh: '本地渲染，不上传' },
        competitor: { en: 'Varies by tool', zh: '因工具而异' },
      },
    ],
    verdict: {
      en: 'For recording app demos across many windows, a screen recorder is the right tool. For whiteboard and diagram explainers, operation-stream capture is strictly better: occlusion-proof, re-framable to any aspect ratio, and private by default.',
      zh: '要录跨多个窗口的应用演示，录屏工具更合适；但对白板 / 图解讲解，操作流采集严格更优：抗遮挡、可重渲染成任意比例、默认隐私。',
    },
    faqs: [
      {
        q: { en: 'Will switching tabs ruin my whiteboard recording?', zh: '切换标签页会毁掉我的白板录制吗？' },
        a: {
          en: 'No. Because Excalicast records the operation stream rather than screen pixels, switching tabs or covering the window does not appear in the exported video, and microphone audio keeps recording.',
          zh: '不会。因为 Excalicast 录的是操作事件流而非屏幕像素，切标签页或遮挡窗口都不会出现在导出视频里，麦克风音频也会继续录制。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-scribe',
    competitor: 'Scribe',
    title: {
      en: 'Excalicast vs Scribe: video vs step-by-step guides',
      zh: 'Excalicast vs Scribe：视频讲解 vs 步骤文档',
    },
    description: {
      en: 'Scribe auto-generates click-by-click text guides; Excalicast records a narrated whiteboard video. Compare when to explain with a diagram vs a process doc.',
      zh: 'Scribe 自动生成点选式步骤文档，Excalicast 录制带旁白的白板视频。看图解讲解和流程文档分别该用谁。',
    },
    intro: {
      en: 'Scribe captures your clicks in an app and turns them into a step-by-step text guide with screenshots; Excalicast records a whiteboard explainer as narrated video. They solve different problems: Scribe documents a process inside software, while Excalicast explains a concept or design you draw and talk through.',
      zh: 'Scribe 记录你在软件里的点击，生成带截图的步骤文档；Excalicast 把白板讲解录成带旁白的视频。两者解决不同问题：Scribe 记录软件内的操作流程，Excalicast 讲解你画出来并口述的概念或设计。',
    },
    rows: [
      {
        feature: { en: 'Output format', zh: '产出形式' },
        excalicast: { en: 'Narrated whiteboard video (MP4)', zh: '带旁白的白板视频（MP4）' },
        competitor: { en: 'Step-by-step text guide + screenshots', zh: '步骤文档 + 截图' },
      },
      {
        feature: { en: 'Best for', zh: '最适合' },
        excalicast: { en: 'Explaining a concept / design / diagram', zh: '讲解概念 / 设计 / 图解' },
        competitor: { en: 'Documenting how to use a tool', zh: '记录工具操作步骤' },
      },
      {
        feature: { en: 'Voice narration', zh: '语音旁白' },
        excalicast: { en: 'Yes, synced to drawing', zh: '有，与作画同步' },
        competitor: { en: 'No (text steps)', zh: '无（文字步骤）' },
      },
      {
        feature: { en: 'Multi aspect-ratio video', zh: '多比例视频' },
        excalicast: { en: '16:9 / 9:16 / 1:1 / 4:5', zh: '16:9 / 9:16 / 1:1 / 4:5' },
        competitor: { en: 'N/A', zh: '不适用' },
      },
    ],
    verdict: {
      en: 'Use Scribe to document a repeatable in-app process as a text guide. Use Excalicast when the explanation is conceptual and benefits from drawing plus voice — a recorded whiteboard video your audience can watch.',
      zh: '要把可复用的软件内操作做成图文文档，用 Scribe；当讲解偏概念、需要边画边说时用 Excalicast——产出一段观众能看的白板视频。',
    },
    faqs: [
      {
        q: { en: 'Is Excalicast a Scribe alternative?', zh: 'Excalicast 是 Scribe 的替代品吗？' },
        a: {
          en: 'Only partly — they target different jobs. Scribe makes text process docs; Excalicast makes narrated whiteboard videos. Choose Excalicast when you need to explain a concept or design by drawing and talking, not document software clicks.',
          zh: '只能算部分替代——两者目标不同。Scribe 做文字流程文档，Excalicast 做带旁白的白板视频。当你要靠边画边说讲解概念或设计（而非记录软件点击）时选 Excalicast。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-excalidraw',
    competitor: 'Excalidraw',
    title: {
      en: 'Can Excalidraw record video? Excalicast adds recording to Excalidraw',
      zh: 'Excalidraw 能录视频吗？Excalicast 给 Excalidraw 加上录制',
    },
    description: {
      en: 'Excalidraw is a whiteboard canvas with no built-in recording. Excalicast records an Excalidraw canvas with voice and exports MP4 in multiple aspect ratios.',
      zh: 'Excalidraw 是没有内置录制的白板画布。Excalicast 在 Excalidraw 画布上录制语音并导出多比例 MP4。',
    },
    intro: {
      en: 'Excalidraw is an open-source infinite whiteboard for drawing, but it does not record video on its own. Excalicast is built on an Excalidraw canvas and adds the recording layer: it captures your operation stream plus microphone audio and exports a narrated MP4 in 16:9, 9:16, 1:1, or 4:5 — so "recording an Excalidraw drawing to video" is exactly what it does.',
      zh: 'Excalidraw 是开源的无限白板，用于作画，但本身不录视频。Excalicast 基于 Excalidraw 画布构建，补上录制层：采集操作事件流 + 麦克风音频，导出 16:9 / 9:16 / 1:1 / 4:5 的带旁白 MP4——「把 Excalidraw 作画录成视频」正是它做的事。',
    },
    rows: [
      {
        feature: { en: 'Drawing canvas', zh: '作画画布' },
        excalicast: { en: 'Yes (Excalidraw-based)', zh: '有（基于 Excalidraw）' },
        competitor: { en: 'Yes', zh: '有' },
      },
      {
        feature: { en: 'Record to video', zh: '录制成视频' },
        excalicast: { en: 'Yes, voice + actions → MP4', zh: '有，语音 + 操作 → MP4' },
        competitor: { en: 'No built-in recording', zh: '无内置录制' },
      },
      {
        feature: { en: 'Multi aspect-ratio export', zh: '多比例导出' },
        excalicast: { en: '16:9 / 9:16 / 1:1 / 4:5', zh: '16:9 / 9:16 / 1:1 / 4:5' },
        competitor: { en: 'PNG / SVG image export only', zh: '仅 PNG / SVG 图片导出' },
      },
      {
        feature: { en: 'Subtitles & AI handouts', zh: '字幕 & AI 讲义' },
        excalicast: { en: 'Yes (Pro / Max)', zh: '有（Pro / Max）' },
        competitor: { en: 'No', zh: '无' },
      },
    ],
    verdict: {
      en: 'If you only need to draw or export a static image, Excalidraw is enough. If you need to record that drawing as a narrated video — and reuse one take across aspect ratios — Excalicast adds exactly that on top of the same canvas.',
      zh: '只需作画或导出静态图，Excalidraw 足够；若要把作画录成带旁白的视频、并一录多比例复用，Excalicast 在同样的画布上正好补齐这一层。',
    },
    faqs: [
      {
        q: { en: 'How do I record an Excalidraw drawing to video?', zh: '怎么把 Excalidraw 作画录成视频？' },
        a: {
          en: 'Use Excalicast: open the browser app, draw on the Excalidraw canvas while recording your voice and actions, then export an MP4. It captures the operation stream, so the video stays clean and re-exports to any aspect ratio.',
          zh: '用 Excalicast：打开浏览器应用，在 Excalidraw 画布上边录语音和操作边作画，然后导出 MP4。它采集操作事件流，视频保持干净并可重导出成任意比例。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-screen-studio',
    competitor: 'Screen Studio',
    title: {
      en: 'Excalicast vs Screen Studio: whiteboard videos',
      zh: 'Excalicast vs Screen Studio：白板讲解 vs 精致录屏',
    },
    description: {
      en: 'Compare Screen Studio and Excalicast for whiteboard videos, auto zoom, browser editing, and multi-ratio MP4 export.',
      zh: 'Screen Studio 是 Mac 上做精致录屏（自动缩放）的应用。Excalicast 通过操作流录制白板，在浏览器内导出多比例。',
    },
    intro: {
      en: 'Screen Studio is a macOS app that produces polished screen recordings with automatic zoom and smooth cursor motion. Excalicast is a browser-based whiteboard recorder that captures the operation stream instead of screen pixels, so for whiteboard explainers it stays clean under occlusion and re-exports one take to 16:9, 9:16, 1:1, and 4:5.',
      zh: 'Screen Studio 是 macOS 应用，能做出带自动缩放、平滑光标的精致录屏。Excalicast 是浏览器白板录制工具，采集操作事件流而非屏幕像素，因此对白板讲解在遮挡下仍保持干净，并能把同一段录制导出 16:9 / 9:16 / 1:1 / 4:5。',
    },
    rows: [
      {
        feature: { en: 'Platform', zh: '平台' },
        excalicast: { en: 'Browser (any OS)', zh: '浏览器（任意系统）' },
        competitor: { en: 'macOS app', zh: 'macOS 应用' },
      },
      {
        feature: { en: 'Capture method', zh: '采集方式' },
        excalicast: { en: 'Whiteboard operation stream', zh: '白板操作事件流' },
        competitor: { en: 'Screen pixels', zh: '屏幕像素' },
      },
      {
        feature: { en: 'Occlusion / minimize safe', zh: '抗遮挡 / 最小化' },
        excalicast: { en: 'Yes', zh: '是' },
        competitor: { en: 'No (captures the screen)', zh: '否（录屏幕）' },
      },
      {
        feature: { en: 'Aspect ratios from one take', zh: '一录多比例' },
        excalicast: { en: '16:9 / 9:16 / 1:1 / 4:5', zh: '16:9 / 9:16 / 1:1 / 4:5' },
        competitor: { en: 'Configurable, but re-render per project', zh: '可配置，但需逐项目重渲染' },
      },
    ],
    verdict: {
      en: 'Screen Studio is excellent for polished app/UI demos on Mac. For whiteboard and diagram explainers, Excalicast is the better fit: cross-platform, occlusion-proof operation-stream capture, and effortless multi-ratio export.',
      zh: 'Screen Studio 很适合 Mac 上做精致的应用 / UI 演示。对白板和图解讲解，Excalicast 更合适：跨平台、抗遮挡的操作流采集、轻松多比例导出。',
    },
    faqs: [
      {
        q: { en: 'Does Excalicast work on Windows like Screen Studio on Mac?', zh: 'Excalicast 像 Screen Studio 限 Mac 一样吗？能在 Windows 用吗？' },
        a: {
          en: 'Excalicast runs in the browser (Chrome/Edge) on any OS, including Windows — unlike Screen Studio, which is macOS-only.',
          zh: 'Excalicast 在任意系统的浏览器（Chrome/Edge）里运行，包括 Windows——而 Screen Studio 仅限 macOS。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-tella',
    competitor: 'Tella',
    title: {
      en: 'Excalicast vs Tella: whiteboard recorder vs screen + camera studio',
      zh: 'Excalicast vs Tella：白板录制 vs 屏幕+摄像头工作室',
    },
    description: {
      en: 'Tella records screen + camera with backgrounds and layouts. Excalicast records a whiteboard via operation stream and exports one take to every aspect ratio.',
      zh: 'Tella 录制屏幕 + 摄像头，带背景和版式。Excalicast 通过操作流录制白板，一录导出每种比例。',
    },
    intro: {
      en: 'Tella is a browser screen-and-camera recorder with styled backgrounds and multi-clip layouts for marketing videos. Excalicast is a whiteboard recorder that captures the operation stream rather than the screen, so whiteboard content is always crisp and the same recording exports to 16:9, 9:16, 1:1, and 4:5.',
      zh: 'Tella 是浏览器里的屏幕 + 摄像头录制工具，带样式化背景和多片段版式，适合做营销视频。Excalicast 是白板录制工具，采集操作流而非屏幕，白板内容始终清晰，同一段录制可导出 16:9 / 9:16 / 1:1 / 4:5。',
    },
    rows: [
      {
        feature: { en: 'Primary capture', zh: '主要采集' },
        excalicast: { en: 'Whiteboard operation stream', zh: '白板操作事件流' },
        competitor: { en: 'Screen + camera pixels', zh: '屏幕 + 摄像头像素' },
      },
      {
        feature: { en: 'Camera bubble overlay', zh: '人像气泡叠加' },
        excalicast: { en: 'Yes (optional, draggable)', zh: '有（可选、可拖拽）' },
        competitor: { en: 'Yes', zh: '有' },
      },
      {
        feature: { en: 'Whiteboard crisp under occlusion', zh: '遮挡下白板清晰' },
        excalicast: { en: 'Yes', zh: '是' },
        competitor: { en: 'No (records screen)', zh: '否（录屏幕）' },
      },
      {
        feature: { en: 'Local-first / no upload', zh: '本地优先 / 不上传' },
        excalicast: { en: 'Yes (renders in browser)', zh: '是（浏览器内渲染）' },
        competitor: { en: 'Cloud-based', zh: '云端' },
      },
    ],
    verdict: {
      en: 'Tella shines for talking-head screen-share marketing clips with styled backgrounds. Excalicast is the better choice when the star of the video is a whiteboard or diagram you draw and narrate.',
      zh: 'Tella 适合做带样式背景的出镜 + 屏幕分享营销短片。当视频主角是你边画边讲的白板或图解时，Excalicast 更合适。',
    },
    faqs: [
      {
        q: { en: 'Can Excalicast add a camera bubble like Tella?', zh: 'Excalicast 能像 Tella 那样加人像气泡吗？' },
        a: {
          en: 'Yes. Excalicast has an optional draggable camera bubble overlay for talking-head explainers, while still capturing the whiteboard via the operation stream.',
          zh: '可以。Excalicast 有可选、可拖拽的人像气泡叠加用于出镜讲解，同时仍通过操作流采集白板。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-veed',
    competitor: 'VEED',
    title: {
      en: 'Excalicast vs VEED: whiteboard recorder vs online video editor',
      zh: 'Excalicast vs VEED：白板录制 vs 在线视频编辑器',
    },
    description: {
      en: 'VEED is an online editor for recording and editing video. Excalicast is purpose-built to record a whiteboard via the operation stream and export multiple aspect ratios.',
      zh: 'VEED 是在线录制和剪辑视频的编辑器。Excalicast 专为通过操作流录制白板、导出多比例而生。',
    },
    intro: {
      en: 'VEED is a general-purpose online video recorder and editor with templates, subtitles, and effects. Excalicast is a focused whiteboard recorder: it captures the operation stream plus voice and exports an MP4 in multiple aspect ratios from one take, rendering locally in the browser.',
      zh: 'VEED 是通用的在线视频录制 + 剪辑器，带模板、字幕和特效。Excalicast 是专注的白板录制工具：采集操作流 + 语音，从一段录制导出多比例 MP4，在浏览器本地渲染。',
    },
    rows: [
      {
        feature: { en: 'Focus', zh: '定位' },
        excalicast: { en: 'Record a whiteboard explainer', zh: '录制白板讲解' },
        competitor: { en: 'General video record + edit', zh: '通用视频录制 + 剪辑' },
      },
      {
        feature: { en: 'Whiteboard operation-stream capture', zh: '白板操作流采集' },
        excalicast: { en: 'Yes', zh: '有' },
        competitor: { en: 'No (screen/webcam)', zh: '无（屏幕/摄像头）' },
      },
      {
        feature: { en: 'One take → many ratios', zh: '一录多比例' },
        excalicast: { en: 'Built in', zh: '内置' },
        competitor: { en: 'Manual resize per export', zh: '逐次手动调整尺寸' },
      },
      {
        feature: { en: 'Rendering', zh: '渲染' },
        excalicast: { en: 'Local (ffmpeg.wasm)', zh: '本地（ffmpeg.wasm）' },
        competitor: { en: 'Cloud', zh: '云端' },
      },
    ],
    verdict: {
      en: 'VEED is a versatile editor when you need timelines, effects, and heavy post-production. Excalicast is faster and cleaner for the specific job of recording and shipping a whiteboard explainer in every aspect ratio.',
      zh: '需要时间线、特效和重后期时，VEED 是全能编辑器。对「录制并发布多比例白板讲解」这个具体任务，Excalicast 更快更干净。',
    },
    faqs: [
      {
        q: { en: 'Does Excalicast do subtitles like VEED?', zh: 'Excalicast 像 VEED 一样能做字幕吗？' },
        a: {
          en: 'Yes, on the Pro plan: subtitles are generated with Alibaba Qwen ASR (optimized for Chinese and English), downloadable as SRT or burned into the MP4.',
          zh: '可以，Pro 档支持：字幕由阿里千问 ASR 生成（中英文优化），可下载 SRT 或烧录进 MP4。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-zoom-recording',
    competitor: 'Zoom recording',
    title: {
      en: 'Excalicast vs Zoom recording: async whiteboard video vs meeting capture',
      zh: 'Excalicast vs Zoom 录制：异步白板视频 vs 会议录制',
    },
    description: {
      en: 'Recording a Zoom meeting captures screen pixels and everyone’s windows. Excalicast records a clean whiteboard async, with multi-ratio export and local-first privacy.',
      zh: '录 Zoom 会议采集的是屏幕像素和各种窗口。Excalicast 异步录制干净的白板，支持多比例导出和本地优先隐私。',
    },
    intro: {
      en: 'Recording a Zoom meeting captures the shared screen as pixels, so overlapping windows, notifications, and participant tiles end up in the file, and the result is locked to one resolution. Excalicast records a whiteboard asynchronously via the operation stream, so the video shows only clean whiteboard content and re-exports to 16:9, 9:16, 1:1, and 4:5.',
      zh: '录 Zoom 会议把共享屏幕当像素采集，遮挡窗口、通知、与会者画面都会进文件，且结果锁死在一个分辨率。Excalicast 通过操作流异步录制白板，视频只有干净的白板内容，并可重导出成 16:9 / 9:16 / 1:1 / 4:5。',
    },
    rows: [
      {
        feature: { en: 'Use mode', zh: '使用方式' },
        excalicast: { en: 'Async recorded explainer', zh: '异步录制讲解' },
        competitor: { en: 'Live meeting capture', zh: '实时会议录制' },
      },
      {
        feature: { en: 'What ends up in the video', zh: '视频里的内容' },
        excalicast: { en: 'Clean whiteboard only', zh: '只有干净白板' },
        competitor: { en: 'Whole shared screen', zh: '整个共享屏幕' },
      },
      {
        feature: { en: 'Re-frame to vertical for social', zh: '改竖屏发社交' },
        excalicast: { en: 'Yes (9:16 from same take)', zh: '可以（同录制出 9:16）' },
        competitor: { en: 'Locked to capture size', zh: '锁死采集尺寸' },
      },
      {
        feature: { en: 'Privacy', zh: '隐私' },
        excalicast: { en: 'Renders locally, no upload', zh: '本地渲染，不上传' },
        competitor: { en: 'Cloud recording', zh: '云端录制' },
      },
    ],
    verdict: {
      en: 'Zoom recording is right for archiving a live call. For a reusable, clean whiteboard explainer you can share async and repurpose to vertical video, Excalicast is the better tool.',
      zh: '要归档一场实时通话，用 Zoom 录制即可。要做可复用、干净、能异步分享并改成竖屏的白板讲解，Excalicast 更合适。',
    },
    faqs: [
      {
        q: { en: 'Why not just share my screen on Zoom and record?', zh: '为什么不直接 Zoom 共享屏幕录制？' },
        a: {
          en: 'Screen-share recording captures pixels, so any overlapping window or notification is baked in and the output is one fixed resolution. Excalicast records the operation stream, keeping the whiteboard clean and re-exportable to any aspect ratio.',
          zh: '共享屏幕录制采集的是像素，任何遮挡窗口或通知都会被烤进去，输出还是单一固定分辨率。Excalicast 录操作流，白板保持干净，可重导出成任意比例。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'excalicast-vs-excalicord',
    competitor: 'Excalicord',
    title: {
      en: 'Excalicast vs Excalicord: recording to publish-ready video',
      zh: 'Excalicast vs Excalicord：从录制到发布就绪视频',
    },
    description: {
      en: 'Compare Excalicast and Excalicord for whiteboard recording, editing, Autozoom, captions, multi-ratio export, and publish-ready output.',
      zh: '对比 Excalicast 与 Excalicord 的白板录制、在线剪辑、Autozoom、字幕、多比例导出与发布就绪工作流。',
    },
    intro: {
      en: 'Excalicord publicly presents a whiteboard video recorder with webcam for visual explanations. Excalicast covers a broader capture-to-publish-ready workflow: multi-source recording, browser timeline editing, assisted cuts, editable Autozoom, captions and handouts, multi-ratio export, and share links on eligible tiers.',
      zh: 'Excalicord 公开定位为带摄像头的视觉讲解白板视频录制器。Excalicast 覆盖更完整的采集到发布就绪工作流：多源录制、浏览器时间线剪辑、辅助裁切、可编辑 Autozoom、字幕与讲义、多比例导出，以及符合权益时的分享链接。',
    },
    directAnswer: {
      en: 'Excalicast and Excalicord are different products. Excalicord focuses publicly on fast whiteboard-and-webcam recording; Excalicast is designed for the full workflow from whiteboard, tab, window, or desktop capture through editing and reusable publish-ready outputs.',
      zh: 'Excalicast 和 Excalicord 是不同产品。Excalicord 的公开重点是快速录制白板与摄像头；Excalicast 面向从白板、标签页、窗口或桌面采集，到剪辑和生成可复用发布就绪成品的完整流程。',
    },
    rows: [
      {
        feature: { en: 'Public product focus', zh: '公开产品重点' },
        excalicast: { en: 'End-to-end recording and editing workspace', zh: '端到端录制与剪辑工作区' },
        competitor: { en: 'Whiteboard videos with webcam', zh: '带摄像头的白板视频' },
      },
      {
        feature: { en: 'Recording sources', zh: '录制来源' },
        excalicast: { en: 'Whiteboard, browser tab, app window, or desktop', zh: '白板、浏览器标签页、应用窗口或桌面' },
        competitor: { en: 'Whiteboard and webcam are public; other sources are publicly undocumented', zh: '官网公开白板与摄像头；其他来源未公开说明' },
      },
      {
        feature: { en: 'Post-recording timeline editing', zh: '录制后时间线剪辑' },
        excalicast: { en: 'Trim, split, delete, and review in browser', zh: '浏览器内裁剪、分割、删除和检查' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
      {
        feature: { en: 'Assisted cuts and editable Autozoom', zh: '辅助裁切与可编辑 Autozoom' },
        excalicast: { en: 'ChatCut-assisted cuts plus editable focus regions', zh: 'ChatCut 辅助裁切 + 可编辑焦点区域' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
      {
        feature: { en: 'Captions and structured handouts', zh: '字幕与结构化讲义' },
        excalicast: { en: 'Available on eligible Pro/Max tiers', zh: '符合 Pro/Max 权益时可用' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
      {
        feature: { en: 'Publish-ready formats', zh: '发布就绪格式' },
        excalicast: { en: 'Landscape, portrait, square, feed, and custom dimensions', zh: '横屏、竖屏、方形、信息流及自定义尺寸' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
      {
        feature: { en: 'Direct social posting', zh: '直接发布到社交平台' },
        excalicast: { en: 'No; creates files and links ready for you to publish', zh: '不支持直发；生成由你发布的成品文件与链接' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
    ],
    bestFor: [
      {
        en: 'Choose Excalicast when one recording must continue through editing, attention design, captions or handouts, and several output formats.',
        zh: '当一段录制需要继续完成剪辑、焦点设计、字幕或讲义，并生成多种成品格式时，选择 Excalicast。',
      },
      {
        en: 'Choose Excalicord when its publicly described whiteboard-and-webcam recording experience matches the complete job you need.',
        zh: '当官网描述的白板 + 摄像头录制体验已经覆盖你的完整需求时，选择 Excalicord。',
      },
    ],
    notBestFor: [
      {
        en: 'Excalicast is not a heavy multi-track editor or an automatic publisher to third-party social accounts.',
        zh: 'Excalicast 不是重型多轨剪辑器，也不会自动发布到第三方社交账号。',
      },
      {
        en: 'Do not infer Excalicord features that its public website does not document; verify them in the product before deciding.',
        zh: '不要推断 Excalicord 官网未公开说明的能力；决策前应在产品内核实。',
      },
    ],
    workflow: END_TO_END_WORKFLOW,
    facts: [
      {
        label: { en: 'Excalicord public positioning', zh: 'Excalicord 公开定位' },
        value: {
          en: '“Record beautiful whiteboard videos with your webcam” and “Like Loom, but for visual explanations.”',
          zh: '“使用摄像头录制精美白板视频”，并称其“像 Loom，但面向视觉讲解”。',
        },
      },
      {
        label: { en: 'Excalicast output boundary', zh: 'Excalicast 输出边界' },
        value: {
          en: 'Creates publish-ready files and eligible share links; it does not claim direct social-platform upload.',
          zh: '生成发布就绪文件和符合权益的分享链接，不声称直接上传社交平台。',
        },
      },
    ],
    limitations: [
      {
        en: 'Excalicord exposes only a small set of product details publicly, so undocumented comparison cells are intentionally left as publicly undocumented.',
        zh: 'Excalicord 对外公开的产品细节较少，因此未披露的对比项统一标记为“官网未公开说明”。',
      },
      {
        en: 'Excalicast advanced captions, handouts, cloud backup, and share links depend on the applicable plan.',
        zh: 'Excalicast 的高级字幕、讲义、云备份和分享链接受对应套餐权益限制。',
      },
    ],
    verdict: {
      en: 'Choose Excalicord for the focused whiteboard-and-webcam recorder it publicly describes. Choose Excalicast when the deliverable needs to move from several capture sources through online editing, Autozoom, supporting knowledge assets, and multiple publish-ready formats in one workflow.',
      zh: '如果官网描述的聚焦白板 + 摄像头录制器就是你的需求，可以选择 Excalicord；如果交付物需要在一条工作流里从多种来源采集，继续完成在线剪辑、Autozoom、知识资产和多种发布就绪格式，选择 Excalicast。',
    },
    faqs: [
      {
        q: { en: 'Are Excalicast and Excalicord the same product?', zh: 'Excalicast 和 Excalicord 是同一个产品吗？' },
        a: {
          en: 'No. They are separate products. Excalicord publicly focuses on whiteboard video with webcam; Excalicast combines multi-source recording with editing and publish-ready outputs.',
          zh: '不是。它们是独立产品。Excalicord 的公开重点是白板视频与摄像头；Excalicast 组合了多源录制、剪辑和发布就绪输出。',
        },
      },
      {
        q: { en: 'Does Excalicast publish directly to social platforms?', zh: 'Excalicast 会直接发布到社交平台吗？' },
        a: {
          en: 'No. It prepares downloadable files in platform-ready dimensions and eligible share links; you remain in control of publishing them.',
          zh: '不会。它生成符合平台尺寸的可下载文件和符合权益的分享链接，最终发布仍由你控制。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'Excalicord official website', zh: 'Excalicord 官网' },
        url: 'https://www.excalicord.com/',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Start a publish-ready recording', zh: '开始制作发布就绪录制' },
      href: '/app?source=whiteboard',
    },
    related: [
      { type: 'compare', slug: 'excalicast-vs-excalidraw' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
  {
    slug: 'excalicast-vs-excalirec',
    competitor: 'ExcaliRec',
    title: {
      en: 'Excalicast vs ExcaliRec: two whiteboard recording workflows',
      zh: 'Excalicast vs ExcaliRec：两种白板录制工作流',
    },
    description: {
      en: 'Compare Excalicast and ExcaliRec for whiteboard capture, automatic zoom, browser editing, captions, handouts, and multi-format output.',
      zh: '对比 Excalicast 与 ExcaliRec 的白板采集、自动缩放、浏览器剪辑、字幕、讲义和多格式输出。',
    },
    intro: {
      en: 'ExcaliRec is a focused browser whiteboard recorder with automatic zoom, webcam, visual styling, and local WebM download. Excalicast adds display-source recording and a deeper post-recording workflow for timeline edits, editable Autozoom, supporting assets, and repeated multi-ratio output.',
      zh: 'ExcaliRec 是聚焦浏览器白板录制的工具，公开支持自动缩放、摄像头、视觉样式和本地 WebM 下载。Excalicast 进一步加入显示源录制，以及时间线剪辑、可编辑 Autozoom、配套资产和反复多比例输出的后期流程。',
    },
    directAnswer: {
      en: 'Use ExcaliRec for a lightweight Excalidraw-style recording that follows drawing activity and downloads locally. Use Excalicast when the same project also needs tab, window, or desktop capture, browser timeline editing, captions or handouts, and several publish-ready renders.',
      zh: '需要轻量的 Excalidraw 风格录制、跟随绘制自动缩放并本地下载时，可选 ExcaliRec；同一项目还需要标签页、窗口或桌面采集、浏览器时间线、字幕或讲义及多份发布就绪成品时，可选 Excalicast。',
    },
    rows: [
      {
        feature: { en: 'Core capture', zh: '核心采集' },
        excalicast: { en: 'Whiteboard plus tab, window, and desktop sources', zh: '白板 + 标签页、窗口与桌面来源' },
        competitor: { en: 'Built-in Excalidraw-style whiteboard', zh: '内置 Excalidraw 风格白板' },
      },
      {
        feature: { en: 'Zoom behavior', zh: '缩放方式' },
        excalicast: { en: 'Editable Autozoom regions on the timeline', zh: '时间线上可编辑的 Autozoom 区域' },
        competitor: { en: 'Automatic zoom follows clicks and drawing activity', zh: '自动缩放跟随点击与绘制活动' },
      },
      {
        feature: { en: 'Recording presentation tools', zh: '录制演示工具' },
        excalicast: { en: 'Camera, microphone, laser pointer, framing, and backgrounds', zh: '摄像头、麦克风、激光笔、取景与背景' },
        competitor: { en: 'Webcam, backgrounds, laser/annotation, slides, and teleprompter', zh: '摄像头、背景、激光/标注、幻灯片与提词器' },
      },
      {
        feature: { en: 'Timeline editing after capture', zh: '录制后时间线剪辑' },
        excalicast: { en: 'Trim, split, delete, assisted cuts, and focus editing', zh: '裁剪、分割、删除、辅助裁切与焦点编辑' },
        competitor: { en: 'Publicly documented as a record-and-download flow; deeper timeline editing is publicly undocumented', zh: '官网公开为录制后下载流程；更深入的时间线剪辑未公开说明' },
      },
      {
        feature: { en: 'Video output', zh: '视频输出' },
        excalicast: { en: 'MP4 renders in standard and custom dimensions', zh: '标准及自定义尺寸的 MP4 渲染' },
        competitor: { en: 'Local WebM, described as ready to convert to MP4', zh: '本地 WebM，官网描述为可继续转换 MP4' },
      },
      {
        feature: { en: 'Captions, chapters, and handouts', zh: '字幕、章节与讲义' },
        excalicast: { en: 'Available on eligible tiers', zh: '符合套餐权益时可用' },
        competitor: { en: 'Publicly undocumented', zh: '官网未公开说明' },
      },
    ],
    bestFor: [
      {
        en: 'ExcaliRec fits creators who want a narrow, local, Excalidraw-style capture with automatic motion and a quick download.',
        zh: 'ExcaliRec 适合需要聚焦、本地、带自动运动效果的 Excalidraw 风格录制并快速下载的创作者。',
      },
      {
        en: 'Excalicast fits creators who need capture, post-recording edits, knowledge assets, and reusable platform formats in one workspace.',
        zh: 'Excalicast 适合需要在一个工作区完成采集、录制后剪辑、知识资产和可复用平台格式的创作者。',
      },
    ],
    notBestFor: [
      {
        en: 'ExcaliRec is intentionally presented as a whiteboard-native recorder, not a replacement for generic desktop capture.',
        zh: 'ExcaliRec 明确定位为白板原生录制器，不是通用桌面采集替代品。',
      },
      {
        en: 'Excalicast is not intended for heavy multi-track filmmaking or direct social-account publishing.',
        zh: 'Excalicast 不面向重型多轨影视制作或社交账号直发。',
      },
    ],
    workflow: END_TO_END_WORKFLOW,
    facts: [
      {
        label: { en: 'ExcaliRec public export', zh: 'ExcaliRec 公开输出' },
        value: { en: 'Local WebM with 16:9, 4:3, 3:4, 9:16, and 1:1 capture formats.', zh: '本地 WebM，公开列出 16:9、4:3、3:4、9:16 与 1:1 录制格式。' },
      },
      {
        label: { en: 'Privacy model', zh: '隐私模式' },
        value: { en: 'Both products publicly describe local browser recording for their whiteboard workflows.', zh: '两款产品都公开说明其白板录制流程在浏览器本地进行。' },
      },
    ],
    limitations: [
      {
        en: 'ExcaliRec free exports include a watermark unless a documented bonus or Creator Pass applies.',
        zh: 'ExcaliRec 免费导出包含水印，除非使用其公开说明的奖励或 Creator Pass。',
      },
      {
        en: 'Excalicast captions, handouts, cloud backup, and share links are plan-dependent and may use opt-in cloud processing.',
        zh: 'Excalicast 的字幕、讲义、云备份和分享链接取决于套餐，并可能使用主动选择的云端处理。',
      },
    ],
    verdict: {
      en: 'ExcaliRec is the more focused record-and-download option for a whiteboard-native explainer. Excalicast is the broader production workspace when one recording must be edited, enriched, reframed, and turned into several publish-ready assets.',
      zh: 'ExcaliRec 更适合白板原生讲解的聚焦录制与下载；当一段录制还要继续剪辑、增强、重新构图并生成多份发布就绪资产时，Excalicast 是更完整的生产工作区。',
    },
    faqs: [
      {
        q: { en: 'Does ExcaliRec have automatic zoom?', zh: 'ExcaliRec 有自动缩放吗？' },
        a: {
          en: 'Yes. Its official site says the camera follows clicks and zooms toward the action. Excalicast instead exposes editable Autozoom focus regions in the post-recording timeline.',
          zh: '有。其官网说明镜头会跟随点击并缩放到操作区域。Excalicast 则在录制后的时间线上提供可编辑 Autozoom 焦点区域。',
        },
      },
      {
        q: { en: 'Which one produces publish-ready MP4 files?', zh: '哪一个能生成发布就绪 MP4？' },
        a: {
          en: 'Excalicast renders MP4 files in standard and custom dimensions. ExcaliRec publicly documents local WebM output that can be converted to MP4.',
          zh: 'Excalicast 可按标准和自定义尺寸渲染 MP4；ExcaliRec 官网公开的是本地 WebM 输出，并说明可继续转换为 MP4。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'ExcaliRec official product and pricing page', zh: 'ExcaliRec 官方产品与定价页' },
        url: 'https://excalirec.com/',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Record and edit a whiteboard video', zh: '录制并剪辑白板视频' },
      href: '/app?source=whiteboard',
    },
    related: [
      { type: 'compare', slug: 'excalicast-vs-excalidraw' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
  {
    slug: 'excalicast-vs-focusee',
    competitor: 'FocuSee',
    title: {
      en: 'Excalicast vs FocuSee: whiteboard workflow or desktop auto-zoom',
      zh: 'Excalicast vs FocuSee：白板全流程还是桌面自动缩放',
    },
    description: {
      en: 'Compare Excalicast and FocuSee for multi-source recording, automatic zoom, browser or desktop editing, captions, exports, and sharing.',
      zh: '对比 Excalicast 与 FocuSee 的多源录制、自动缩放、浏览器或桌面剪辑、字幕、导出与分享。',
    },
    intro: {
      en: 'FocuSee is a Windows and Mac screen recorder that automates cursor-following zooms, backgrounds, and presentation styling for software demos. Excalicast is browser-based and adds whiteboard operation-stream capture plus a capture-to-publish-ready workflow for visual explanations.',
      zh: 'FocuSee 是 Windows 与 Mac 桌面录屏工具，会为软件演示自动生成光标跟随缩放、背景和演示样式。Excalicast 在浏览器中运行，增加白板操作流采集，并为视觉讲解提供从采集到发布就绪的完整工作流。',
    },
    directAnswer: {
      en: 'Choose FocuSee when polished desktop software demos and automatic cursor-driven motion are the priority. Choose Excalicast when whiteboard clarity, browser access, editable focus regions, supporting knowledge assets, and repeated multi-format output matter more.',
      zh: '优先制作精致桌面软件演示和光标驱动自动运动时，选择 FocuSee；更重视白板清晰度、浏览器使用、可编辑焦点区域、配套知识资产和反复多格式输出时，选择 Excalicast。',
    },
    rows: [
      {
        feature: { en: 'Platform', zh: '运行平台' },
        excalicast: { en: 'Browser-based', zh: '浏览器运行' },
        competitor: { en: 'Desktop app for Windows and Mac', zh: 'Windows 与 Mac 桌面应用' },
      },
      {
        feature: { en: 'Capture specialization', zh: '采集专长' },
        excalicast: { en: 'Whiteboard operation stream plus display sources', zh: '白板操作流 + 显示源' },
        competitor: { en: 'Screen, selfie, and voiceover for software demos', zh: '面向软件演示的屏幕、摄像头与旁白' },
      },
      {
        feature: { en: 'Automatic focus', zh: '自动聚焦' },
        excalicast: { en: 'Editable Autozoom regions and magnification', zh: '可编辑 Autozoom 区域与倍率' },
        competitor: { en: 'Automatic cursor following and dynamic zoom effects', zh: '自动跟随光标并生成动态缩放' },
      },
      {
        feature: { en: 'Editing', zh: '剪辑' },
        excalicast: { en: 'Browser timeline plus ChatCut-assisted cut suggestions', zh: '浏览器时间线 + ChatCut 辅助裁切建议' },
        competitor: { en: 'Trim, cut, crop, and speed controls', zh: '裁剪、切除、画面裁切与变速' },
      },
      {
        feature: { en: 'Captions and handouts', zh: '字幕与讲义' },
        excalicast: { en: 'Captions plus eligible chapters and structured handouts', zh: '字幕，以及符合权益的章节与结构化讲义' },
        competitor: { en: 'Automatic editable captions; structured handouts are publicly undocumented', zh: '自动可编辑字幕；结构化讲义未公开说明' },
      },
      {
        feature: { en: 'Exports and sharing', zh: '导出与分享' },
        excalicast: { en: 'MP4 in standard/custom dimensions plus eligible share links', zh: '标准/自定义尺寸 MP4 + 符合权益的分享链接' },
        competitor: { en: 'Video up to 4K, GIF, social presets, links, and embeds', zh: '最高 4K 视频、GIF、社交预设、链接与嵌入' },
      },
    ],
    bestFor: [
      {
        en: 'FocuSee is best for desktop product demos that benefit from automatic cursor motion, visual frames, and high-resolution video or GIF export.',
        zh: 'FocuSee 最适合需要自动光标运动、视觉边框及高分辨率视频或 GIF 的桌面产品演示。',
      },
      {
        en: 'Excalicast is best for whiteboard-led explanations that also need display capture, editable focus, captions or handouts, and reusable aspect ratios.',
        zh: 'Excalicast 最适合以白板为主、同时需要显示源采集、可编辑焦点、字幕或讲义及可复用比例的视觉讲解。',
      },
    ],
    notBestFor: [
      {
        en: 'Excalicast is not a desktop-native 4K/GIF product-demo studio.',
        zh: 'Excalicast 不是桌面原生的 4K/GIF 产品演示工作室。',
      },
      {
        en: 'FocuSee public materials do not document Excalidraw operation-stream capture or structured handout generation.',
        zh: 'FocuSee 公开资料未说明 Excalidraw 操作流采集或结构化讲义生成。',
      },
    ],
    workflow: END_TO_END_WORKFLOW,
    facts: [
      {
        label: { en: 'FocuSee automation', zh: 'FocuSee 自动化' },
        value: { en: 'Its official page documents cursor following, dynamic zoom, backgrounds, and automated post-production.', zh: '其官网明确公开光标跟随、动态缩放、背景和自动后期处理。' },
      },
      {
        label: { en: 'Excalicast whiteboard capture', zh: 'Excalicast 白板采集' },
        value: { en: 'Records whiteboard events rather than displayed pixels, while display sources use screen capture.', zh: '白板模式记录事件而非显示像素；显示源模式则使用屏幕采集。' },
      },
    ],
    limitations: [
      {
        en: 'The products overlap on screen recording and zoom but optimize for different primary jobs: desktop demos versus whiteboard-led content production.',
        zh: '两款产品在录屏和缩放上有交集，但主要任务不同：桌面演示与白板主导的内容生产。',
      },
      {
        en: 'Neither comparison implies automatic posting to third-party social accounts; outputs still need to be published by the creator.',
        zh: '本对比不暗示自动发布到第三方社交账号；成品仍需创作者自行发布。',
      },
    ],
    verdict: {
      en: 'FocuSee is the stronger fit for desktop-first software demos with automated visual polish. Excalicast is the stronger fit for browser-based visual explanations that move from several capture sources into editable focus, knowledge assets, and multiple publish-ready formats.',
      zh: '桌面优先的软件演示和自动视觉润色更适合 FocuSee；需要从多种来源采集，继续完成可编辑焦点、知识资产和多种发布就绪格式的浏览器视觉讲解更适合 Excalicast。',
    },
    faqs: [
      {
        q: { en: 'Do both Excalicast and FocuSee support automatic zoom?', zh: 'Excalicast 和 FocuSee 都支持自动缩放吗？' },
        a: {
          en: 'Yes, with different workflows. FocuSee automatically follows cursor activity; Excalicast stores editable Autozoom regions on the recording timeline.',
          zh: '支持，但工作方式不同。FocuSee 自动跟随光标活动；Excalicast 把可编辑 Autozoom 区域保存在录制时间线上。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'FocuSee official product page', zh: 'FocuSee 官方产品页' },
        url: 'https://gemoo.com/focusee/index.htm',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Try the browser workflow', zh: '体验浏览器全流程' },
      href: '/app?source=desktop',
    },
    related: [
      { type: 'compare', slug: 'excalicast-vs-screen-studio' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
  {
    slug: 'excalicast-vs-explain-everything',
    competitor: 'Explain Everything',
    title: {
      en: 'Excalicast vs Explain Everything: publishing workflow or collaborative whiteboard',
      zh: 'Excalicast vs Explain Everything：发布工作流还是协作白板',
    },
    description: {
      en: 'Compare Excalicast and Explain Everything for whiteboard recording, timeline editing, collaboration, video export, captions, and publish-ready assets.',
      zh: '对比 Excalicast 与 Explain Everything 的白板录制、时间线剪辑、协作、视频导出、字幕和发布就绪资产。',
    },
    intro: {
      en: 'Explain Everything is a collaborative whiteboarding platform with canvas recording, separate audio and visual tracks, timeline editing, slides, and Web Video Links. Excalicast focuses less on live collaboration and more on turning whiteboard or display-source recordings into reusable publish-ready video and knowledge assets.',
      zh: 'Explain Everything 是协作白板平台，公开支持画布录制、独立音视频轨道、时间线剪辑、幻灯片和 Web Video Link。Excalicast 较少强调实时协作，更专注于把白板或显示源录制变成可复用的发布就绪视频与知识资产。',
    },
    directAnswer: {
      en: 'Choose Explain Everything for collaborative teaching, mixed-media whiteboarding, and layered canvas recordings. Choose Excalicast for a leaner creator workflow spanning source capture, browser editing, editable Autozoom, captions or handouts, and several publish-ready video dimensions.',
      zh: '需要协作教学、混合媒体白板和分层画布录制时，选择 Explain Everything；需要更精简的创作者流程，从来源采集到浏览器剪辑、可编辑 Autozoom、字幕或讲义及多种发布就绪视频尺寸时，选择 Excalicast。',
    },
    rows: [
      {
        feature: { en: 'Primary product', zh: '主要产品形态' },
        excalicast: { en: 'Recording and editing workspace for visual explainers', zh: '视觉讲解录制与剪辑工作区' },
        competitor: { en: 'Collaborative mixed-media whiteboarding platform', zh: '协作式混合媒体白板平台' },
      },
      {
        feature: { en: 'Recording model', zh: '录制模型' },
        excalicast: { en: 'Whiteboard event stream or display-source media', zh: '白板事件流或显示源媒体' },
        competitor: { en: 'Canvas object interactions with separate audio/video tracks', zh: '画布对象交互 + 独立音视频轨道' },
      },
      {
        feature: { en: 'Timeline editing', zh: '时间线剪辑' },
        excalicast: { en: 'Trim, split, delete, assisted cuts, and Autozoom regions', zh: '裁剪、分割、删除、辅助裁切与 Autozoom 区域' },
        competitor: { en: 'Selection delete, split, layered clips, and recording modes', zh: '选区删除、分割、分层片段与录制模式' },
      },
      {
        feature: { en: 'Collaboration', zh: '协作' },
        excalicast: { en: 'Share playback on eligible tiers; live co-editing is not the core workflow', zh: '符合权益时分享回放；实时共编不是核心流程' },
        competitor: { en: 'Real-time and asynchronous whiteboard collaboration', zh: '实时与异步白板协作' },
      },
      {
        feature: { en: 'Autozoom and assisted cuts', zh: 'Autozoom 与辅助裁切' },
        excalicast: { en: 'Editable Autozoom plus ChatCut-assisted cuts', zh: '可编辑 Autozoom + ChatCut 辅助裁切' },
        competitor: { en: 'These specific automation features are publicly undocumented', zh: '这些特定自动化能力未公开说明' },
      },
      {
        feature: { en: 'Outputs', zh: '输出' },
        excalicast: { en: 'Multi-dimension MP4, captions, eligible handouts and share links', zh: '多尺寸 MP4、字幕，以及符合权益的讲义与分享链接' },
        competitor: { en: 'Web Video Links; mobile apps also document video-file export', zh: 'Web Video Link；移动端还公开支持视频文件导出' },
      },
    ],
    bestFor: [
      {
        en: 'Explain Everything is best for classrooms and teams that need live collaboration, mixed media, slide-based projects, and layered recordings.',
        zh: 'Explain Everything 最适合需要实时协作、混合媒体、幻灯片项目和分层录制的课堂与团队。',
      },
      {
        en: 'Excalicast is best for individual creators turning whiteboard or screen-based explanations into several publish-ready outputs.',
        zh: 'Excalicast 最适合把白板或屏幕讲解转成多份发布就绪成品的个人创作者。',
      },
    ],
    notBestFor: [
      {
        en: 'Excalicast is not positioned as a live collaborative classroom whiteboard.',
        zh: 'Excalicast 不定位为实时协作课堂白板。',
      },
      {
        en: 'Explain Everything public documentation does not describe ChatCut-style cut proposals, Excalicast-style Autozoom tracks, or structured handout generation.',
        zh: 'Explain Everything 公开文档未说明 ChatCut 式裁切建议、Excalicast 式 Autozoom 轨道或结构化讲义生成。',
      },
    ],
    workflow: END_TO_END_WORKFLOW,
    facts: [
      {
        label: { en: 'Explain Everything editing', zh: 'Explain Everything 剪辑' },
        value: { en: 'Official help documents selection deletion, clip splitting, recording modes, and separate audio/video tracks.', zh: '官方帮助文档公开选区删除、片段分割、录制模式和独立音视频轨道。' },
      },
      {
        label: { en: 'Web export boundary', zh: '网页端输出边界' },
        value: { en: 'Its official help says the web version shares video through a Web Video Link; mobile apps document file export.', zh: '其官方帮助说明网页版本通过 Web Video Link 分享视频；移动应用公开支持文件导出。' },
      },
    ],
    limitations: [
      {
        en: 'Explain Everything capabilities vary by web and mobile platform, so the device-specific official documentation should be checked before choosing.',
        zh: 'Explain Everything 的能力因网页端和移动端而异，选择前应核对对应设备的官方文档。',
      },
      {
        en: 'Excalicast share links and structured handouts require eligible plans, and live collaboration is outside its core scope.',
        zh: 'Excalicast 分享链接和结构化讲义需要符合套餐权益，实时协作不在其核心范围。',
      },
    ],
    verdict: {
      en: 'Explain Everything is the more complete collaborative whiteboard and classroom environment. Excalicast is the more focused capture-to-publish-ready production path for creators who need editable focus, supporting assets, and repeated platform-specific renders.',
      zh: 'Explain Everything 是更完整的协作白板与课堂环境；Excalicast 是更聚焦的采集到发布就绪生产路径，适合需要可编辑焦点、配套资产和反复生成平台特定成品的创作者。',
    },
    faqs: [
      {
        q: { en: 'Can Explain Everything edit a whiteboard recording?', zh: 'Explain Everything 能剪辑白板录制吗？' },
        a: {
          en: 'Yes. Its official help documents timeline selection deletion, clip splitting, layered clips, and mix, overwrite, and insert recording modes, with some platform differences.',
          zh: '能。其官方帮助公开了时间线选区删除、片段分割、分层片段，以及混合、覆盖和插入录制模式，部分能力因平台而异。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'Explain Everything product overview', zh: 'Explain Everything 产品概览' },
        url: 'https://help.explaineverything.com/hc/en-us/articles/360014138733-What-is-Explain-Everything',
      },
      {
        label: { en: 'Explain Everything recording and timeline guide', zh: 'Explain Everything 录制与时间线指南' },
        url: 'https://help.explaineverything.com/hc/en-us/articles/360013332774-Introduction-to-Recording',
      },
      {
        label: { en: 'Explain Everything editing guide', zh: 'Explain Everything 剪辑指南' },
        url: 'https://help.explaineverything.com/hc/en-us/articles/360013808794-Edit-recordings',
      },
      {
        label: { en: 'Explain Everything video export and sharing guide', zh: 'Explain Everything 视频导出与分享指南' },
        url: 'https://help.explaineverything.com/hc/en-us/articles/360015309834-Export-and-Share-a-recording-as-a-video',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Create a publish-ready explainer', zh: '制作发布就绪讲解' },
      href: '/app?source=whiteboard',
    },
    related: [
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
  {
    slug: 'excalicast-vs-screenity',
    competitor: 'Screenity',
    title: {
      en: 'Excalicast vs Screenity: whiteboard production or browser screen editing',
      zh: 'Excalicast vs Screenity：白板生产还是浏览器录屏剪辑',
    },
    description: {
      en: 'Compare Excalicast and Screenity for browser recording, editing, automatic zoom, captions, privacy, sharing, and publish-ready video.',
      zh: '对比 Excalicast 与 Screenity 的浏览器录制、剪辑、自动缩放、字幕、隐私、分享和发布就绪视频。',
    },
    intro: {
      en: 'Screenity combines a free open-source Chrome recorder with a paid browser editor for scenes, click zooms, captions, layouts, MP4 export, and links. Excalicast adds operation-stream whiteboard capture, structured learning assets, and a workflow built around re-rendering visual explanations for several platform dimensions.',
      zh: 'Screenity 把免费开源 Chrome 录制器与付费浏览器编辑器组合起来，支持场景、点击缩放、字幕、布局、MP4 导出和链接。Excalicast 增加白板操作流采集、结构化学习资产，以及为多个平台尺寸重新渲染视觉讲解的工作流。',
    },
    directAnswer: {
      en: 'Choose Screenity for a capable general browser screen recorder and scene-based editor. Choose Excalicast when Excalidraw-native clarity, whiteboard events, structured handouts, and reusable landscape, portrait, square, feed, or custom renders are central to the job.',
      zh: '需要强大的通用浏览器录屏和场景式编辑器时，选择 Screenity；工作核心是 Excalidraw 原生清晰度、白板事件、结构化讲义，以及可复用的横屏、竖屏、方形、信息流或自定义渲染时，选择 Excalicast。',
    },
    rows: [
      {
        feature: { en: 'Recording access', zh: '录制入口' },
        excalicast: { en: 'Browser app, no extension required for core recording', zh: '浏览器应用，核心录制无需扩展' },
        competitor: { en: 'Free Chrome extension or built-in web recorder', zh: '免费 Chrome 扩展或内置网页录制器' },
      },
      {
        feature: { en: 'Sources', zh: '来源' },
        excalicast: { en: 'Whiteboard, tab, window, or desktop with camera and mic', zh: '白板、标签页、窗口或桌面 + 摄像头与麦克风' },
        competitor: { en: 'Tab, app/window, whole screen, camera, mic, and supported internal audio', zh: '标签页、应用/窗口、全屏、摄像头、麦克风及支持的内部音频' },
      },
      {
        feature: { en: 'Editing model', zh: '剪辑模型' },
        excalicast: { en: 'Timeline clips, assisted cuts, and Autozoom regions', zh: '时间线片段、辅助裁切与 Autozoom 区域' },
        competitor: { en: 'Scenes, layouts, split/trim/cut, overlays, and animations', zh: '场景、布局、分割/裁剪/切除、叠加元素与动画' },
      },
      {
        feature: { en: 'Zoom', zh: '缩放' },
        excalicast: { en: 'Editable regions with center, timing, and magnification', zh: '可编辑中心、时间与倍率的区域' },
        competitor: { en: 'Clicks become editable zoom keyframes', zh: '点击转成可编辑缩放关键帧' },
      },
      {
        feature: { en: 'Captions and knowledge assets', zh: '字幕与知识资产' },
        excalicast: { en: 'Captions plus eligible chapters and structured handouts', zh: '字幕 + 符合权益的章节与结构化讲义' },
        competitor: { en: 'Editable word-level captions; structured handouts are publicly undocumented', zh: '可编辑逐词字幕；结构化讲义未公开说明' },
      },
      {
        feature: { en: 'Storage and sharing', zh: '存储与分享' },
        excalicast: { en: 'Local-first recording; opt-in cloud features and eligible share links', zh: '本地优先录制；主动选择云功能和符合权益的分享链接' },
        competitor: { en: 'Local free recorder; encrypted EU cloud editor and paid share links', zh: '免费录制器本地保存；加密欧盟云编辑器与付费分享链接' },
      },
    ],
    bestFor: [
      {
        en: 'Screenity is best for general browser and app demos needing scene composition, overlays, animated layouts, click zooms, and captions.',
        zh: 'Screenity 最适合需要场景编排、叠加元素、动态布局、点击缩放和字幕的通用浏览器与应用演示。',
      },
      {
        en: 'Excalicast is best for whiteboard-led explainers that need clean event-stream capture, learning assets, and repeatable multi-dimension outputs.',
        zh: 'Excalicast 最适合需要干净事件流采集、学习资产和可重复多尺寸输出的白板主导讲解。',
      },
    ],
    notBestFor: [
      {
        en: 'Excalicast does not match Screenity’s public emphasis on multi-scene composition, overlay animation, music, or device mockups.',
        zh: 'Excalicast 不以 Screenity 公开强调的多场景编排、叠加动画、音乐或设备样机为重点。',
      },
      {
        en: 'Screenity public materials do not document Excalidraw operation-stream capture or structured chapter-and-handout generation.',
        zh: 'Screenity 公开资料未说明 Excalidraw 操作流采集或结构化章节与讲义生成。',
      },
    ],
    workflow: END_TO_END_WORKFLOW,
    facts: [
      {
        label: { en: 'Screenity free recorder', zh: 'Screenity 免费录制器' },
        value: { en: 'Officially described as free, open source, local, without sign-in, watermark, or recording time limit.', zh: '官网描述为免费、开源、本地运行，无需登录、无水印且无录制时长限制。' },
      },
      {
        label: { en: 'Screenity editor', zh: 'Screenity 编辑器' },
        value: { en: 'The paid editor publicly includes scenes, click zooms, captions, layouts, MP4 export, and share links.', zh: '其付费编辑器公开包含场景、点击缩放、字幕、布局、MP4 导出和分享链接。' },
      },
    ],
    limitations: [
      {
        en: 'Screenity’s free extension and paid cloud editor have different feature and account boundaries.',
        zh: 'Screenity 的免费扩展与付费云编辑器具有不同的功能和账号边界。',
      },
      {
        en: 'Excalicast advanced captions, handouts, cloud backup, and sharing are also tier-dependent; neither product publishes directly to social accounts.',
        zh: 'Excalicast 高级字幕、讲义、云备份和分享同样受套餐限制；两者都不代表直接发布到社交账号。',
      },
    ],
    verdict: {
      en: 'Screenity is the more expansive general browser recorder and scene editor. Excalicast is the more specialized end-to-end option for whiteboard-led content that must stay crisp, become knowledge assets, and render repeatedly for different publishing formats.',
      zh: 'Screenity 是更全面的通用浏览器录制与场景编辑器；Excalicast 是更专门的白板内容端到端方案，让画面保持清晰、生成知识资产，并为不同发布格式反复渲染。',
    },
    faqs: [
      {
        q: { en: 'Is Screenity free and open source?', zh: 'Screenity 免费且开源吗？' },
        a: {
          en: 'Its Chrome recorder is publicly described as free and open source. The advanced browser editor, cloud storage, and sharing are paid features with a trial.',
          zh: '其 Chrome 录制器公开说明为免费开源；高级浏览器编辑器、云存储和分享是带试用的付费功能。',
        },
      },
      {
        q: { en: 'Which product is more specialized for Excalidraw videos?', zh: '哪款产品更专注 Excalidraw 视频？' },
        a: {
          en: 'Excalicast is built around an Excalidraw whiteboard operation stream as well as display sources. Screenity is a broader pixel-based screen recorder and editor.',
          zh: 'Excalicast 围绕 Excalidraw 白板操作流构建，同时支持显示源；Screenity 是覆盖更广的像素式录屏与编辑器。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'Screenity official product page', zh: 'Screenity 官方产品页' },
        url: 'https://screenity.io/',
      },
      {
        label: { en: 'Screenity free recorder page', zh: 'Screenity 免费录制器页面' },
        url: 'https://screenity.io/extension',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Start a whiteboard-first recording', zh: '开始白板优先录制' },
      href: '/app?source=current_tab',
    },
    related: [
      { type: 'compare', slug: 'excalicast-vs-screen-recording' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
];

export function getCompareEntry(slug: string): CompareEntry | undefined {
  return COMPARE_ENTRIES.find((e) => e.slug === slug);
}
