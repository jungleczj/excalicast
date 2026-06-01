import type { CompareEntry } from './types';

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
      en: 'Excalicast vs Loom: a whiteboard recorder alternative',
      zh: 'Excalicast vs Loom：白板录制工具替代方案',
    },
    description: {
      en: 'Loom records screen pixels; Excalicast records the whiteboard operation stream and exports one take to 16:9, 9:16, 1:1, and 4:5. Compare features and pricing.',
      zh: 'Loom 录制屏幕像素，Excalicast 录制白板操作事件流，一次录制导出 16:9 / 9:16 / 1:1 / 4:5。对比功能与定价。',
    },
    intro: {
      en: 'Excalicast is a browser-based whiteboard recorder and a Loom alternative for whiteboard explainers: instead of capturing screen pixels, it records the Excalidraw operation stream plus microphone audio, so recordings are never affected by window occlusion or minimization and the same take exports to multiple aspect ratios.',
      zh: 'Excalicast 是一款浏览器白板录制工具，也是白板讲解场景下的 Loom 替代方案：它采集的是 Excalidraw 操作事件流 + 麦克风音频，而非屏幕像素，因此录制完全不受窗口遮挡或最小化影响，同一段录制可导出多种比例。',
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
      en: 'Excalicast vs Screen Studio: whiteboard explainer vs polished screen recording',
      zh: 'Excalicast vs Screen Studio：白板讲解 vs 精致录屏',
    },
    description: {
      en: 'Screen Studio is a Mac app for polished screen recordings with auto-zoom. Excalicast records a whiteboard via the operation stream and exports multiple ratios in the browser.',
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
];

export function getCompareEntry(slug: string): CompareEntry | undefined {
  return COMPARE_ENTRIES.find((e) => e.slug === slug);
}
