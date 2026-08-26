import type { BlogEntry } from './types';

/** Blog posts modelled as structured blocks (no MDX toolchain needed). */
const RAW_BLOG_ENTRIES: Omit<BlogEntry, 'updatedAt' | 'author' | 'sources' | 'heroMedia' | 'keyTakeaways'>[] = [
  {
    slug: 'record-whiteboard-without-screen-recording',
    title: {
      en: 'How to record a whiteboard without screen recording',
      zh: '如何在不录屏的情况下录制白板',
    },
    description: {
      en: 'Screen recording captures pixels and breaks on occlusion. Here is how operation-stream capture records a whiteboard cleanly and exports to any aspect ratio.',
      zh: '录屏采集像素、遇遮挡就出错。本文讲操作流采集如何干净地录制白板并导出任意比例。',
    },
    date: '2026-06-01',
    intro: {
      en: 'You can record a whiteboard to video without any screen-recording software by capturing the operation stream instead of screen pixels — this is how Excalicast produces clean, re-framable whiteboard videos in the browser.',
      zh: '不用任何录屏软件也能把白板录成视频：采集操作事件流而非屏幕像素——这正是 Excalicast 在浏览器里产出干净、可重新构图的白板视频的方式。',
    },
    body: [
      {
        heading: { en: 'The problem with screen recording', zh: '录屏的问题' },
        paragraphs: [
          {
            en: 'Screen recorders capture whatever pixels are painted on the display. If another window overlaps the browser, a notification pops up, or you minimize the tab, those pixels go straight into your video. The output is also locked to the capture resolution, so you cannot later reframe it for a different platform.',
            zh: '录屏工具采集的是显示器上画出来的像素。如果有别的窗口压在浏览器上、弹出通知、或者你把标签页最小化，这些像素就直接进了视频。输出还锁死在采集分辨率，之后无法为其他平台重新构图。',
          },
        ],
      },
      {
        heading: { en: 'Operation-stream capture', zh: '操作流采集' },
        paragraphs: [
          {
            en: 'Instead of reading the screen, Excalicast records the whiteboard operation stream — the sequence of drawing actions — together with microphone audio. At export time it replays those actions onto an offscreen canvas and renders frames there, so the video shows only the whiteboard, never an overlapping window.',
            zh: 'Excalicast 不读屏幕，而是录制白板操作事件流——也就是作画动作的序列——并配合麦克风音频。导出时它把这些动作在离屏画布上重放并渲染每一帧，因此视频里只有白板，绝不会有遮挡窗口。',
          },
          {
            en: 'Because frames are re-rendered from the operation stream, the same recording can be exported at 16:9, 9:16, 1:1, or 4:5 without recording again.',
            zh: '由于每一帧都是从操作流重新渲染的，同一段录制可以导出 16:9、9:16、1:1 或 4:5，无需重新录制。',
          },
        ],
      },
      {
        heading: { en: 'Privacy as a side effect', zh: '隐私是顺带的好处' },
        paragraphs: [
          {
            en: 'The operation stream and audio stay in your browser (IndexedDB), and the MP4 renders locally via ffmpeg.wasm. Raw recordings never leave your computer.',
            zh: '操作事件流和音频留在你的浏览器里（IndexedDB），MP4 通过 ffmpeg.wasm 在本地渲染。原始录制数据从不离开你的电脑。',
          },
        ],
      },
    ],
    faqs: [
      {
        q: { en: 'Does minimizing the browser stop the recording?', zh: '最小化浏览器会停止录制吗？' },
        a: {
          en: 'Audio keeps recording when minimized, and because frames come from the operation stream rather than the screen, there is no black-screen problem on export.',
          zh: '最小化时音频继续录制，且由于帧来自操作流而非屏幕，导出时不会有黑屏问题。',
        },
      },
    ],
    related: [
      { type: 'compare', slug: 'excalicast-vs-screen-recording' },
      { type: 'compare', slug: 'excalicast-vs-loom' },
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
    ],
  },
  {
    slug: 'one-recording-every-aspect-ratio',
    title: {
      en: 'One recording, every aspect ratio: 16:9 vs 9:16 vs 1:1',
      zh: '一次录制，导出每种比例：16:9 vs 9:16 vs 1:1',
    },
    description: {
      en: 'Why re-recording for each platform is unnecessary: export 16:9, 9:16, 1:1, and 4:5 from a single whiteboard take and ship to YouTube, TikTok, and Instagram.',
      zh: '为什么不必为每个平台重录：从同一段白板录制导出 16:9、9:16、1:1、4:5，一次投 YouTube、抖音、Instagram。',
    },
    date: '2026-06-01',
    intro: {
      en: 'A single whiteboard recording can be exported to every common aspect ratio — 16:9 for YouTube, 9:16 for Shorts and TikTok, 1:1 and 4:5 for feeds — because Excalicast re-renders frames from the operation stream rather than cropping a fixed video.',
      zh: '同一段白板录制可以导出每种常见比例——16:9 给 YouTube，9:16 给 Shorts 和抖音，1:1 与 4:5 给信息流——因为 Excalicast 从操作流重新渲染每一帧，而不是裁切一个固定视频。',
    },
    body: [
      {
        heading: { en: 'Why platforms need different ratios', zh: '为什么各平台需要不同比例' },
        paragraphs: [
          {
            en: 'Horizontal 16:9 fits YouTube and desktop players. Vertical 9:16 fills the screen on Shorts, Reels, and TikTok. Square 1:1 and portrait 4:5 perform well in social feeds. Posting a 16:9 video to a vertical feed wastes most of the screen.',
            zh: '横向 16:9 适配 YouTube 和桌面播放器。竖向 9:16 在 Shorts、Reels、抖音上铺满屏幕。方形 1:1 和竖版 4:5 在社交信息流里表现更好。把 16:9 视频发到竖屏信息流会浪费大半屏幕。',
          },
        ],
      },
      {
        heading: { en: 'Reframe, do not re-record', zh: '重新构图，而非重录' },
        paragraphs: [
          {
            en: 'In Excalicast you pick a crop frame before recording so you know what is in shot, but the underlying operation stream covers the whole canvas. At export you choose any ratio and the frames re-render to fit — one take becomes a YouTube video and a vertical Short.',
            zh: '在 Excalicast 里你录前先选裁切框，知道入镜范围，但底层操作流覆盖整个画布。导出时你选任意比例，帧会重新渲染适配——一段录制既是 YouTube 视频，也是竖屏 Short。',
          },
        ],
      },
    ],
    related: [
      { type: 'use-case', slug: 'whiteboard-video-for-youtube-shorts' },
      { type: 'blog', slug: 'repurpose-one-recording-into-shorts-reels' },
    ],
  },
  {
    slug: 'loom-alternatives-for-whiteboard',
    title: {
      en: 'The best Loom alternatives for whiteboard explainers (2026)',
      zh: '2026 年最适合白板讲解的 Loom 替代品',
    },
    description: {
      en: 'Compare Loom and focused whiteboard recording workflows by source type, editing, reframing, and publishing needs.',
      zh: '从采集来源、编辑、重新构图和发布需求出发，对比 Loom 与专用白板录制工作流。',
    },
    date: '2026-06-01',
    intro: {
      en: 'For a whiteboard-first explanation, compare tools by what they preserve. Loom is a broad screen-and-camera recorder; Excalicast adds a structured operation-stream workflow for its built-in whiteboard and ordinary display capture for selected screen sources.',
      zh: '白板优先的讲解应按工具真正保留的内容来比较。Loom 是通用屏幕与摄像头录制工具；Excalicast 为内置白板提供结构化操作流工作流，并为所选屏幕来源提供普通显示采集。',
    },
    body: [
      {
        heading: { en: 'When a general screen recorder is enough', zh: '什么时候通用录屏已经足够' },
        paragraphs: [
          {
            en: 'Loom is a practical choice when the subject is an app, browser tab, camera, or asynchronous team update. A purpose-built whiteboard workflow matters when you want drawing operations to remain structured and to render the same explanation again for another frame.',
            zh: '当主体是应用、浏览器标签页、摄像头或异步团队更新时，Loom 是实用选择。当你希望绘制操作保持结构化，并把同一段讲解重新渲染到另一画幅时，专用白板工作流才更重要。',
          },
        ],
      },
      {
        heading: { en: 'The shortlist', zh: '候选清单' },
        paragraphs: [
          {
            en: 'Excalicast focuses on whiteboard operations, browser editing, and multi-format rendering. Tella focuses on polished screen-and-camera presentations, while Screen Studio focuses on Mac screen demos with automatic motion. Meeting platforms serve a different capture intent. Verify current plans and features on each product’s official site before choosing.',
            zh: 'Excalicast 聚焦白板操作、浏览器编辑和多格式渲染；Tella 聚焦精致的屏幕与摄像头演示；Screen Studio 聚焦带自动镜头运动的 Mac 屏幕演示。会议平台对应另一种采集意图。选择前应在各产品官网重新核实当前套餐与功能。',
          },
        ],
      },
    ],
    related: [
      { type: 'compare', slug: 'excalicast-vs-loom' },
      { type: 'compare', slug: 'excalicast-vs-tella' },
      { type: 'compare', slug: 'excalicast-vs-screen-studio' },
      { type: 'compare', slug: 'excalicast-vs-zoom-recording' },
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
    ],
  },
  {
    slug: 'repurpose-one-recording-into-shorts-reels',
    title: {
      en: 'Turn one whiteboard recording into a YouTube video, Short, and Reel',
      zh: '把一段白板录制变成 YouTube 视频、Shorts 和 Reels',
    },
    description: {
      en: 'Stop re-recording for each platform. Export 16:9 for YouTube and 9:16 for Shorts, Reels, and TikTok from a single whiteboard take.',
      zh: '别再为每个平台重录。从同一段白板录制导出 16:9（YouTube）和 9:16（Shorts/Reels/抖音）。',
    },
    date: '2026-06-01',
    intro: {
      en: 'You can repurpose one whiteboard recording into a horizontal YouTube video and a vertical Short or Reel without recording twice, because Excalicast re-renders frames from the operation stream to fit any aspect ratio.',
      zh: '你可以把一段白板录制同时变成横屏 YouTube 视频和竖屏 Shorts / Reels，无需录两次——因为 Excalicast 从操作流重新渲染每一帧以适配任意比例。',
    },
    body: [
      {
        heading: { en: 'One take, many cuts', zh: '一次录制，多种剪裁' },
        paragraphs: [
          {
            en: 'Record once with a crop frame in mind, then export 16:9 for YouTube and 9:16 for Shorts, Reels, and TikTok. Because the frames are re-rendered rather than cropped from a fixed video, vertical exports stay sharp and well-composed.',
            zh: '带着裁切框录一次，然后导出 16:9（YouTube）和 9:16（Shorts/Reels/抖音）。由于帧是重新渲染而非从固定视频裁切，竖屏导出依然清晰、构图得当。',
          },
        ],
      },
      {
        heading: { en: 'A simple repurposing workflow', zh: '一个简单的一鱼多吃流程' },
        paragraphs: [
          {
            en: 'Export the 16:9 master for YouTube, then export the 9:16 version and add burned-in captions for silent autoplay feeds. Link the long video in the Short’s description to drive cross-platform traffic.',
            zh: '先导出 16:9 主版发 YouTube，再导出 9:16 版并加烧录字幕适配静音自动播放的信息流。在 Shorts 简介里放长视频链接，驱动跨平台流量。',
          },
        ],
      },
    ],
    related: [
      { type: 'use-case', slug: 'whiteboard-video-for-youtube-shorts' },
      { type: 'blog', slug: 'one-recording-every-aspect-ratio' },
      { type: 'compare', slug: 'excalicast-vs-screen-recording' },
    ],
  },
  {
    slug: 'record-whiteboard-lectures-online-teaching',
    title: {
      en: 'Recording whiteboard lectures for online teaching: a complete guide',
      zh: '为在线教学录制白板讲座：完整指南',
    },
    description: {
      en: 'A complete guide to recording whiteboard lectures for online courses — clean capture, synced voice, auto subtitles, and export in the ratio your platform needs.',
      zh: '为在线课程录制白板讲座的完整指南——干净采集、同步语音、自动字幕，按平台所需比例导出。',
    },
    date: '2026-06-01',
    intro: {
      en: 'To record whiteboard lectures for online teaching, capture the operation stream plus voice in the browser, add subtitles, and export an MP4 in your platform’s aspect ratio — no screen-recording software and no sign-up to get started.',
      zh: '为在线教学录制白板讲座：在浏览器里采集操作流 + 语音，加字幕，按平台所需比例导出 MP4——无需录屏软件、开始无需注册。',
    },
    body: [
      {
        heading: { en: 'Why operation-stream capture matters for teaching', zh: '为什么教学要用操作流采集' },
        paragraphs: [
          {
            en: 'Teachers often switch tabs to pull up references mid-lesson. With screen recording that mess ends up in the video; with operation-stream capture the lecture stays clean and the audio keeps recording, so the lesson flows uninterrupted.',
            zh: '老师上课常切到别的标签页找资料。用录屏，这些杂乱会进视频；用操作流采集，讲座保持干净、音频继续录，课程不被打断。',
          },
        ],
      },
      {
        heading: { en: 'Subtitles and accessibility', zh: '字幕与无障碍' },
        paragraphs: [
          {
            en: 'On the Pro plan, generate subtitles with Alibaba Qwen ASR (Chinese & English) and download SRT or burn them in. Captions improve accessibility and watch-time, and help non-native learners follow along.',
            zh: '在 Pro 档用阿里千问 ASR（中英文）生成字幕，下载 SRT 或烧录进视频。字幕提升无障碍和完播率，也帮助非母语学习者跟上。',
          },
        ],
      },
    ],
    related: [
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
      { type: 'use-case', slug: 'record-online-course-lesson' },
      { type: 'use-case', slug: 'record-math-tutorial' },
      { type: 'use-case', slug: 'add-subtitles-to-whiteboard-video' },
    ],
  },
];

const BLOG_AUTHOR = {
  name: { en: 'Excalicast Editorial Team', zh: 'Excalicast 编辑团队' },
  url: '/about',
};

export const BLOG_ENTRIES: BlogEntry[] = RAW_BLOG_ENTRIES.map((entry) => ({
  ...entry,
  updatedAt: '2026-08-26',
  author: BLOG_AUTHOR,
  sources: [
    {
      label: { en: 'Excalicast product and data-boundary overview', zh: 'Excalicast 产品与数据边界说明' },
      url: 'https://excalicast.cc/en/about',
    },
  ],
  heroMedia: {
    url: '/opengraph-image',
    alt: { en: `${entry.title.en} — Excalicast guide`, zh: `${entry.title.zh} — Excalicast 指南` },
  },
  keyTakeaways: [entry.intro, entry.body[0]?.paragraphs[0] ?? entry.intro],
}));

export function getBlogEntry(slug: string): BlogEntry | undefined {
  return BLOG_ENTRIES.find((e) => e.slug === slug);
}
