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
  {
    slug: 'how-to-screen-record-on-windows-11',
    title: {
      en: 'How to screen record on a PC with Windows 11',
      zh: '如何在 Windows 11 电脑上录屏',
    },
    description: {
      en: 'Compare the built-in Windows 11 screen recorder options with a browser workflow for recording screen, camera, voice, and whiteboard explanations.',
      zh: '比较 Windows 11 内置录屏方式与浏览器工作流，录制屏幕、摄像头、语音和白板讲解。',
    },
    date: '2026-09-01',
    intro: {
      en: 'If you are asking how to screen record on PC, Windows 11 gives you Snipping Tool and Xbox Game Bar; a browser recorder such as Excalicast is better when the recording also needs a camera, whiteboard, timeline edits, captions, or multiple export ratios.',
      zh: '如果你想知道怎样在 PC 上录屏，Windows 11 自带截图工具和 Xbox Game Bar；当录制还需要摄像头、白板、时间线剪辑、字幕或多画幅导出时，Excalicast 这样的浏览器录制器更合适。',
    },
    body: [
      {
        heading: { en: 'Pick the right Windows 11 screen recorder', zh: '先选对 Windows 11 录屏方式' },
        paragraphs: [{
          en: 'The best screen recorder Windows 11 workflow depends on the job. Snipping Tool is quick for a selected region. Xbox Game Bar is convenient for an app or game. OBS is powerful for scenes and live production. Excalicast is designed for structured visual explanations that combine a selected display source, camera, microphone, and an editable whiteboard.',
          zh: '最合适的 Windows 11 录屏方式取决于任务。截图工具适合快速录制选区，Xbox Game Bar 适合应用或游戏，OBS 适合场景编排和直播；Excalicast 则面向结构化视觉讲解，可组合所选屏幕来源、摄像头、麦克风与可编辑白板。',
        }],
      },
      {
        heading: { en: 'Method 1: record a region with Snipping Tool', zh: '方法一：用截图工具录制选区' },
        paragraphs: [{
          en: 'Open Snipping Tool, switch from screenshot to recording, choose New, drag around the region, and start. This is the lowest-friction built-in method, but it is intentionally simple: use another editor if you need a camera layout, a presentation background, automatic zoom regions, or a reusable publishing workflow.',
          zh: '打开截图工具，从截图切到录制，点击“新建”，框选区域后开始。它是阻力最低的内置方法，但功能刻意保持简单；如果需要摄像头布局、演示背景、自动缩放区域或可复用的发布流程，就要使用另一套编辑工具。',
        }],
      },
      {
        heading: { en: 'Method 2: record an app with Xbox Game Bar', zh: '方法二：用 Xbox Game Bar 录制应用' },
        paragraphs: [{
          en: 'Open the app you want to capture and press Windows+G. The Capture widget can start a recording, while Windows+Alt+R is the direct shortcut. Game Bar is useful for a single supported app, but it is not the best fit for a narrated lesson that moves between a diagram, browser content, and a camera view.',
          zh: '先打开要捕获的应用，再按 Windows+G；在“捕获”小组件中开始录制，Windows+Alt+R 则是直接快捷键。Game Bar 适合单个受支持应用，但不适合在图表、网页内容和摄像头视图之间切换的讲解课。',
        }],
      },
      {
        heading: { en: 'Method 3: record and edit a visual explanation in the browser', zh: '方法三：在浏览器里录制并编辑视觉讲解' },
        paragraphs: [{
          en: 'In Excalicast, choose a display source, camera, microphone, or whiteboard, confirm the preview, then record. After the take, trim the timeline, adjust editable Autozoom regions, add captions, and export the same project for horizontal or vertical viewing. Record screen Windows 11 searches often hide this second half of the job: capture is only useful when the result is ready to share.',
          zh: '在 Excalicast 中选择屏幕来源、摄像头、麦克风或白板，确认预览后开始录制。录完后可以修剪时间线、调整可编辑的 Autozoom 区域、添加字幕，并把同一项目导出为横屏或竖屏。很多“Windows 11 录屏”教程忽略了工作的后半程：只有能直接分享，采集才真正有用。',
        }],
      },
      {
        heading: { en: 'Audio, privacy, and quality checklist', zh: '音频、隐私与画质检查清单' },
        paragraphs: [{
          en: 'Before the real take, make a short test recording. Confirm the microphone, system-audio permission, selected capture surface, notification settings, and output ratio. Keep sensitive windows outside the selected source. Excalicast keeps its structured whiteboard recording data local in the browser; ordinary display capture still records the selected pixels, so preview the source carefully.',
          zh: '正式录制前先做一段短测试，确认麦克风、系统音频权限、所选捕获表面、通知设置和输出比例。把敏感窗口放在所选来源之外。Excalicast 的结构化白板录制数据保留在浏览器本地；普通屏幕采集仍会录下所选像素，因此务必仔细检查预览。',
        }],
      },
    ],
    faqs: [
      { q: { en: 'What is the shortcut to record screen on Windows 11?', zh: 'Windows 11 录屏快捷键是什么？' }, a: { en: 'Windows+Alt+R starts or stops an Xbox Game Bar recording for a supported app. Windows+G opens Game Bar controls.', zh: 'Windows+Alt+R 可为受支持应用开始或停止 Xbox Game Bar 录制；Windows+G 打开 Game Bar 控件。' } },
      { q: { en: 'Can Windows 11 record screen and microphone together?', zh: 'Windows 11 能同时录屏和麦克风吗？' }, a: { en: 'Yes. Built-in and browser tools can capture a microphone when permission is enabled. Run a short test because system-audio behavior depends on the selected tool and source.', zh: '可以。启用权限后，内置和浏览器工具都能采集麦克风。系统音频行为取决于工具和来源，建议先短测。' } },
      { q: { en: 'Do I need to install a screen recorder?', zh: '是否必须安装录屏软件？' }, a: { en: 'No. Windows includes basic recorders, and Excalicast runs in a supported browser. Install a desktop tool only when its capture or production features match your needs better.', zh: '不必。Windows 自带基础录制器，Excalicast 也可在受支持浏览器中运行；只有桌面工具的采集或制作能力更符合需求时才需要安装。' } },
    ],
    related: [
      { type: 'compare', slug: 'excalicast-vs-screen-recording' },
      { type: 'compare', slug: 'excalicast-vs-screen-studio' },
      { type: 'use-case', slug: 'product-demo-for-pm' },
    ],
  },
  {
    slug: 'screencasting-guide',
    title: { en: 'Screencasting: a practical guide to clear visual explanations', zh: 'Screencasting 实用指南：制作清晰的视觉讲解' },
    description: { en: 'Learn what screencasting is, which capture workflow to choose, and how to plan, record, edit, caption, and publish a useful screencast.', zh: '了解什么是屏幕演示、如何选择采集工作流，以及怎样规划、录制、剪辑、加字幕并发布。' },
    date: '2026-09-01',
    intro: { en: 'Screencasting is the practice of recording activity on a screen, usually with narration, to demonstrate a process or explain an idea. The strongest screencasts are planned around one viewer outcome rather than around every feature a recorder can capture.', zh: 'Screencasting 是录制屏幕活动并通常配上旁白，用来演示流程或解释观点。最好的屏幕演示围绕一个明确的观众结果来规划，而不是把录制器能捕获的所有功能都塞进去。' },
    body: [
      { heading: { en: 'What counts as a screencast?', zh: '什么算作 Screencast？' }, paragraphs: [{ en: 'A screencast can be a two-minute bug report, a narrated product demo, a software tutorial, an asynchronous status update, or a full lesson. It differs from a live stream because the result is normally edited and watched later, and it differs from a camera-first video because the screen carries most of the explanation.', zh: 'Screencast 可以是两分钟的缺陷说明、带旁白的产品演示、软件教程、异步进度更新或完整课程。它与直播不同，因为成片通常会被编辑并稍后观看；它也不同于摄像头主导的视频，因为屏幕承担了主要讲解。' }] },
      { heading: { en: 'Choose pixels or structured whiteboard actions', zh: '选择像素采集还是结构化白板操作' }, paragraphs: [{ en: 'Conventional screencasting records pixels from a tab, window, or display. That is correct for software demos. A whiteboard explanation can preserve more editing flexibility when the recorder also stores drawing actions, timing, and audio as structured data. Excalicast supports ordinary selected-display capture and a separate operation-stream workflow for its built-in whiteboard.', zh: '传统屏幕演示从标签页、窗口或显示器采集像素，适合软件演示。白板讲解若同时把绘制动作、时间和音频保存为结构化数据，就能保留更多编辑空间。Excalicast 既支持普通的所选屏幕采集，也为内置白板提供独立操作流工作流。' }] },
      { heading: { en: 'Write a one-outcome outline', zh: '先写一个单一结果的大纲' }, paragraphs: [{ en: 'State what the viewer will be able to do, then list only the steps required to reach that result. Prepare example data, close unrelated tabs, and decide where a diagram or camera view adds clarity. This small outline removes pauses and makes later trimming much faster.', zh: '先写清观众看完后能做什么，再只列出达到结果所需的步骤。准备好示例数据，关闭无关标签页，并决定哪里加入图表或摄像头视图会更清楚。这份小纲要能减少停顿，也让后续修剪更快。' }] },
      { heading: { en: 'Record for editing, not perfection', zh: '为可编辑性录制，而不是追求一次完美' }, paragraphs: [{ en: 'Use a short audio check, leave a beat between sections, and restart a sentence instead of restarting the entire take. Capture cursor motion deliberately. When drawing, pause after a key point so the viewer has time to read it. These habits create obvious edit points without making the delivery sound robotic.', zh: '先做简短音频检查，在段落之间留一点空白，说错一句就重说而不是整段重录。让光标移动有明确目的；绘图到关键点后稍停，让观众有时间阅读。这些习惯能产生清晰剪辑点，又不会让表达显得机械。' }] },
      { heading: { en: 'Edit, caption, and publish for the destination', zh: '按发布渠道剪辑、加字幕与导出' }, paragraphs: [{ en: 'Remove dead time, emphasize important regions, and add captions for silent playback and accessibility. Export 16:9 for long-form players and a focused 9:16 cut for vertical feeds. A useful publishing package also includes a descriptive title, a short summary, chapter-like headings, and a link to the next action.', zh: '删掉空白时间，强调重要区域，并为静音观看和无障碍添加字幕。长视频播放器导出 16:9，竖屏信息流则制作聚焦的 9:16 版本。完整发布包还应包含描述性标题、简短摘要、章节式小标题和下一步链接。' }] },
    ],
    faqs: [
      { q: { en: 'What is the difference between screen recording and screencasting?', zh: '录屏与 Screencasting 有什么区别？' }, a: { en: 'Screen recording describes the capture mechanism. Screencasting describes the explanatory format: a recorded screen, usually with narration and an intended viewer outcome.', zh: '录屏描述采集机制；Screencasting 描述讲解形式：录下屏幕，通常配有旁白并面向明确的观看结果。' } },
      { q: { en: 'How long should a screencast be?', zh: 'Screencast 应该多长？' }, a: { en: 'As short as the promised outcome allows. Split unrelated outcomes into separate videos so titles, chapters, and search intent stay precise.', zh: '以完成承诺结果所需的最短时长为准。把无关结果拆成不同视频，让标题、章节和搜索意图保持准确。' } },
      { q: { en: 'Can a screencast include a whiteboard and camera?', zh: 'Screencast 能包含白板和摄像头吗？' }, a: { en: 'Yes. Multi-source layouts can combine a selected display, camera, microphone, and whiteboard when each source helps the explanation.', zh: '可以。只要每个来源都有助于讲解，多源布局就能组合所选屏幕、摄像头、麦克风和白板。' } },
    ],
    related: [{ type: 'use-case', slug: 'product-demo-for-pm' }, { type: 'use-case', slug: 'async-architecture-walkthrough' }, { type: 'blog', slug: 'record-whiteboard-without-screen-recording' }],
  },
  {
    slug: 'best-screen-recorder-for-mac',
    title: { en: 'Best screen recorder for Mac: choose by workflow, not hype', zh: 'Mac 最佳录屏工具：按工作流选择，而不是看宣传' },
    description: { en: 'Compare the Mac screenshot toolbar, QuickTime, OBS, Screen Studio, Loom, and Excalicast for tutorials, product demos, and whiteboard videos.', zh: '比较 Mac 截图工具栏、QuickTime、OBS、Screen Studio、Loom 与 Excalicast，适配教程、产品演示和白板视频。' },
    date: '2026-09-01',
    intro: { en: 'The best screen recorder for Mac is the one that matches the output: Apple’s built-in recorder for a quick clip, OBS for advanced production, Screen Studio for polished Mac demos, Loom for asynchronous sharing, or Excalicast for a browser-based visual explanation with whiteboard and timeline editing.', zh: 'Mac 上最好的录屏工具取决于成片目标：快速片段用 Apple 内置录制器，高级制作选 OBS，精致 Mac 演示选 Screen Studio，异步分享选 Loom，带白板和时间线编辑的浏览器视觉讲解可选 Excalicast。' },
    body: [
      { heading: { en: 'Quick decision table', zh: '快速决策表' }, paragraphs: [{ en: 'Choose the Screenshot toolbar when you need a clean screen file now. Choose QuickTime for a familiar basic workflow. Choose OBS for scenes, sources, and production control. Choose Screen Studio for automated motion and polished Mac app demos. Choose Loom for a fast share link. Choose Excalicast when a display recording needs to become an edited explanation with whiteboard, camera, captions, or multiple aspect ratios.', zh: '立刻需要干净屏幕文件时选截图工具栏；熟悉基础流程可用 QuickTime；场景、来源和制作控制选 OBS；自动镜头运动与精致 Mac 应用演示选 Screen Studio；快速分享链接选 Loom；当屏幕录制需要变成带白板、摄像头、字幕或多画幅的完整讲解时选 Excalicast。' }] },
      { heading: { en: 'Use the built-in Mac recorder for simple capture', zh: '简单采集先用 Mac 内置录制器' }, paragraphs: [{ en: 'Press Shift-Command-5 to open Apple’s screenshot and recording controls, then choose the entire screen or a selected portion. It is fast and requires no new account. The tradeoff is a minimal post-production workflow, so plan to move the file into another editor for camera composition, detailed cuts, callouts, or captions.', zh: '按 Shift-Command-5 打开 Apple 截图和录制控件，再选择整个屏幕或选定区域。它速度快，也不需要新账号；代价是后期流程很精简，摄像头构图、精细剪辑、标注或字幕通常要把文件移到其他编辑器。' }] },
      { heading: { en: 'Use a production recorder for scenes and live control', zh: '多场景与实时控制使用制作型录制器' }, paragraphs: [{ en: 'OBS is a strong fit when you need layered scenes, detailed audio routing, streaming, or precise output controls. That power adds setup work. For a repeatable course or channel, the investment can pay off; for a single narrated walkthrough, a smaller workflow may reach the finish line faster.', zh: '需要分层场景、详细音频路由、直播或精确输出控制时，OBS 很合适，但也带来更多设置工作。对长期课程或频道来说值得投入；对一次性旁白演示，小型工作流可能更快完成。' }] },
      { heading: { en: 'Use a polished demo recorder for automatic motion', zh: '自动镜头运动使用精致演示录制器' }, paragraphs: [{ en: 'Screen Studio is built around polished Mac screen demos and automatic zoom behavior. It is attractive when the screen itself is the story. Loom prioritizes fast asynchronous recording and sharing. Compare both against the exact editing, collaboration, export, and platform requirements you have today because product plans change.', zh: 'Screen Studio 围绕精致 Mac 屏幕演示和自动缩放打造，适合“屏幕本身就是故事”的内容；Loom 优先快速异步录制与分享。产品套餐会变化，应按当前所需的编辑、协作、导出和平台要求核实。' }] },
      { heading: { en: 'Use Excalicast for whiteboard-first explanations', zh: '白板优先讲解使用 Excalicast' }, paragraphs: [{ en: 'Excalicast runs in a supported browser and can combine selected display capture with camera and microphone sources. Its built-in whiteboard uses structured operation-stream capture, which is different from ordinary pixel recording. The timeline, editable Autozoom regions, captions, handouts, share links, and multi-ratio export keep the explanation in one workflow.', zh: 'Excalicast 在受支持浏览器中运行，可把所选屏幕采集与摄像头、麦克风组合。其内置白板使用结构化操作流采集，与普通像素录制不同。时间线、可编辑 Autozoom 区域、字幕、讲义、分享链接与多画幅导出让讲解留在一个工作流中。' }] },
    ],
    faqs: [
      { q: { en: 'Does Mac have a built-in screen recorder?', zh: 'Mac 自带录屏吗？' }, a: { en: 'Yes. Press Shift-Command-5 to open Apple’s screenshot toolbar and choose a full-screen or selected-area recording.', zh: '自带。按 Shift-Command-5 打开 Apple 截图工具栏，可选择全屏或选区录制。' } },
      { q: { en: 'Which Mac recorder is best for tutorials?', zh: '哪款 Mac 录屏最适合教程？' }, a: { en: 'Use a tool that supports the tutorial’s sources and post-production needs. Simple steps may only need Apple’s recorder; structured visual lessons benefit from editing, captions, camera, and whiteboard support.', zh: '应按教程所需来源和后期能力选择。简单步骤用 Apple 录制器即可；结构化视觉课程更需要剪辑、字幕、摄像头和白板支持。' } },
      { q: { en: 'Can a browser record the screen on Mac?', zh: '浏览器能在 Mac 上录屏吗？' }, a: { en: 'Yes, after you grant browser and macOS screen-recording permission and select a capture surface. Preview the exact tab, window, or display before recording.', zh: '可以，但需要授予浏览器与 macOS 屏幕录制权限并选择捕获表面。录制前应预览准确的标签页、窗口或显示器。' } },
    ],
    related: [{ type: 'compare', slug: 'excalicast-vs-screen-studio' }, { type: 'compare', slug: 'excalicast-vs-loom' }, { type: 'use-case', slug: 'online-screen-recorder' }],
  },
  {
    slug: 'whiteboard-animation-and-hand-drawn-explainers',
    title: { en: 'Whiteboard animation vs hand-drawn explainer videos', zh: '白板动画与手绘讲解视频：区别与制作方法' },
    description: { en: 'Understand whiteboard animation, hand drawn animation, and animated explainer video workflows—and choose live drawing, frame animation, or templates.', zh: '理解白板动画、手绘动画和动画讲解视频的工作流，选择实时绘制、逐帧动画或模板制作。' },
    date: '2026-09-01',
    intro: { en: 'Whiteboard animation shows ideas appearing through drawing, while hand drawn animation usually creates motion frame by frame. A whiteboard explainer video is one practical outcome; the broader animated explainer video category may use either style, motion graphics, templates, or a recorded live-whiteboard performance.', zh: '白板动画通过绘制过程让观点逐步出现，而手绘动画通常逐帧创造运动。白板讲解视频是其中一种实际成片；更宽泛的动画讲解视频还可采用任一风格、动态图形、模板或录制现场白板演示。' },
    body: [
      { heading: { en: 'Three terms that solve different jobs', zh: '三个术语解决不同任务' }, paragraphs: [{ en: 'Whiteboard animation is a visual storytelling style built around marks appearing on a light canvas. Hand drawn animation refers to animation created from drawn frames, whether on paper or digitally. Animated explainer video describes the communication goal: making an idea, product, or process easier to understand with animation. Treating them as synonyms leads to the wrong tool and production estimate.', zh: '白板动画是一种围绕浅色画布上逐步出现笔迹的视觉叙事风格；手绘动画指用纸上或数字绘制帧制作的动画；动画讲解视频描述沟通目标——借助动画让观点、产品或流程更容易理解。把三者当成同义词会选错工具，也会误判制作成本。' }] },
      { heading: { en: 'Choose live whiteboard recording for authentic explanation', zh: '真实讲解选择现场白板录制' }, paragraphs: [{ en: 'A live whiteboard workflow records a real explanation as the presenter draws and speaks. It preserves human pacing and is efficient for lessons, architecture diagrams, math, and product thinking. Excalicast stores built-in whiteboard operations with audio, then lets the creator trim, reframe, caption, and export the explanation instead of animating every frame.', zh: '现场白板工作流在讲者边画边说时记录真实讲解，保留人的节奏，适合课程、架构图、数学和产品思考。Excalicast 把内置白板操作与音频一起保存，创作者随后修剪、重新构图、加字幕并导出，而不必逐帧制作动画。' }] },
      { heading: { en: 'Choose template animation for speed and consistency', zh: '速度与一致性优先时选择模板动画' }, paragraphs: [{ en: 'Template tools such as VideoScribe, Powtoon, Canva, and Animaker can assemble scenes from libraries, text, characters, and prepared drawing effects. This is useful when brand consistency matters more than the spontaneity of a live drawing. Check current asset licenses, export limits, and watermark rules before production.', zh: 'VideoScribe、Powtoon、Canva、Animaker 等模板工具能用素材库、文字、角色和预制绘制效果组装场景。品牌一致性比现场绘制的自然感更重要时，这类工具很有用。制作前应核实当前素材许可、导出限制和水印规则。' }] },
      { heading: { en: 'Choose frame-by-frame animation for expressive motion', zh: '表现力运动选择逐帧动画' }, paragraphs: [{ en: 'Traditional or digital hand drawn animation gives the artist direct control over poses, timing, expressions, and movement. It also requires many drawings and specialist skill. Use it when motion and character performance carry the message, not merely to imitate a hand writing headings on a board.', zh: '传统或数字手绘动画让艺术家直接控制姿势、节奏、表情与运动，但也需要大量绘制和专业技能。当动作与角色表演承担主要信息时使用它，而不是仅为了模仿一只手在白板上写标题。' }] },
      { heading: { en: 'A five-step explainer workflow', zh: '五步讲解视频工作流' }, paragraphs: [{ en: 'First, define one audience problem and one promised outcome. Second, write a spoken script before designing scenes. Third, storyboard one visual beat for each claim. Fourth, record live drawing or build the animation in the chosen tool. Fifth, edit for pacing, add accurate captions, verify every factual claim, and export for the destination. The style should serve comprehension rather than decoration.', zh: '第一，定义一个观众问题和一个承诺结果；第二，先写口播稿再设计场景；第三，为每个论点画一个视觉节拍；第四，现场录制绘图或在所选工具中制作动画；第五，按节奏剪辑、添加准确字幕、核实每项事实并按渠道导出。风格应服务理解，而不是只做装饰。' }] },
    ],
    faqs: [
      { q: { en: 'Is whiteboard animation the same as hand drawn animation?', zh: '白板动画等于手绘动画吗？' }, a: { en: 'No. Whiteboard animation is a presentation style; hand-drawn animation is a frame-making technique. A whiteboard video may be live recorded, templated, or animated frame by frame.', zh: '不等同。白板动画是呈现风格，手绘动画是逐帧制作技术；白板视频可以是现场录制、模板制作或逐帧动画。' } },
      { q: { en: 'What makes an animated explainer video effective?', zh: '什么让动画讲解视频有效？' }, a: { en: 'One clear audience problem, a concise spoken narrative, visuals that explain each claim, credible evidence, readable captions, and a specific next action.', zh: '一个明确的观众问题、简洁口述叙事、真正解释论点的画面、可信证据、可读字幕和具体下一步。' } },
      { q: { en: 'Can Excalicast create character animation?', zh: 'Excalicast 能制作角色动画吗？' }, a: { en: 'Excalicast is not a frame-by-frame character-animation suite. It is strongest for recording and editing live whiteboard and multi-source visual explanations.', zh: 'Excalicast 不是逐帧角色动画套件；它最擅长录制和编辑现场白板及多来源视觉讲解。' } },
    ],
    related: [{ type: 'blog', slug: 'whiteboard-animation-software-comparison' }, { type: 'use-case', slug: 'record-whiteboard-lecture' }, { type: 'blog', slug: 'record-whiteboard-without-screen-recording' }, { type: 'compare', slug: 'excalicast-vs-explain-everything' }],
  },
  {
    slug: 'whiteboard-animation-software-comparison',
    title: {
      en: 'Whiteboard animation software comparison chart (2026)',
      zh: '2026 白板动画软件比较表：8 款工具怎么选',
    },
    description: {
      en: 'Compare the best whiteboard animation software for live drawing, templates, character animation, collaboration, captions, and multi-format export.',
      zh: '比较适合现场绘制、模板动画、角色动画、协作、字幕和多格式导出的白板动画软件。',
    },
    date: '2026-09-01',
    intro: {
      en: 'This whiteboard animation software comparison chart separates three jobs that search results often mix together: recording a real whiteboard explanation, building a template animation, and producing frame-by-frame character motion. Excalicast is strongest for live whiteboard explainers; VideoScribe, Canva, Powtoon, Animaker, Renderforest, and Explain Everything serve different animation or collaboration needs.',
      zh: '这份白板动画软件比较表把搜索结果里常被混为一谈的三类任务拆开：录制真实白板讲解、用模板制作动画、逐帧制作角色运动。Excalicast 最适合现场白板讲解；VideoScribe、Canva、Powtoon、Animaker、Renderforest 和 Explain Everything 分别覆盖不同的动画或协作需求。',
    },
    body: [
      {
        heading: { en: 'Quick picks by production method', zh: '按制作方式快速选择' },
        paragraphs: [{
          en: 'Choose Excalicast when you want to draw and narrate naturally, then trim, caption, reframe, and export the recording. Choose VideoScribe for a dedicated draw-on whiteboard animation workflow. Choose Canva for fast template-led social assets, Powtoon or Animaker for broader animated presentations, Renderforest for template production, and Explain Everything for interactive teaching and collaborative whiteboards. Use a specialist frame-animation application when character acting and motion—not the explanation—are the core craft.',
          zh: '需要自然地边画边讲，再修剪、加字幕、重新构图与导出时选择 Excalicast；需要专门的手绘出现效果时选择 VideoScribe；快速制作模板化社交素材可选 Canva；更广泛的动画演示可选 Powtoon 或 Animaker；模板化生产可看 Renderforest；互动教学和协作白板可选 Explain Everything。当角色表演和运动本身才是核心时，应使用专业逐帧动画应用。',
        }],
      },
      {
        heading: { en: 'Whiteboard animation software comparison', zh: '白板动画软件核心比较' },
        paragraphs: [{
          en: 'Excalicast: live whiteboard and multi-source recording, browser timeline, editable Autozoom, captions, handouts, share links, and several output ratios. VideoScribe: purpose-built whiteboard animation assembled from prepared assets and drawing effects. Canva: templates, brand assets, collaboration, and broad social formats. Powtoon and Animaker: animated presentation scenes, characters, and asset libraries. Renderforest: guided template production. Explain Everything: interactive whiteboard teaching and collaboration. None is universally best; the best whiteboard animation software is the one whose production model matches the intended video.',
          zh: 'Excalicast：现场白板与多来源录制、浏览器时间线、可编辑 Autozoom、字幕、讲义、分享链接和多种输出比例。VideoScribe：用预制素材与绘制效果组装专用白板动画。Canva：模板、品牌素材、协作与广泛社交画幅。Powtoon 和 Animaker：动画演示场景、角色与素材库。Renderforest：引导式模板生产。Explain Everything：互动白板教学与协作。没有任何工具对所有人都最好；最好的白板动画软件取决于其制作模型是否匹配目标视频。',
        }],
      },
      {
        heading: { en: 'Compare the criteria that change the finished video', zh: '比较真正改变成片的标准' },
        paragraphs: [{
          en: 'Evaluate capture model, drawing control, camera and microphone support, editing depth, caption workflow, aspect ratios, collaboration, asset licensing, watermark rules, privacy, and total export cost. A long feature checklist can hide the decisive difference: a live recording preserves authentic explanation and speed, while a scene builder offers repeatability and brand control but requires more assembly.',
          zh: '应比较采集模型、绘制控制、摄像头与麦克风支持、剪辑深度、字幕流程、画幅、协作、素材许可、水印规则、隐私和总导出成本。很长的功能清单可能掩盖决定性差异：现场录制保留真实讲解和速度；场景构建器提供可重复性和品牌控制，但需要更多组装工作。',
        }],
      },
      {
        heading: { en: 'Live whiteboard recording versus template animation', zh: '现场白板录制与模板动画' },
        paragraphs: [{
          en: 'A whiteboard explainer video for a lesson, architecture walkthrough, math proof, or product idea often benefits from live pacing: the viewer sees the reasoning unfold while hearing the presenter. A marketing campaign with several languages, strict brand scenes, reusable characters, and multiple reviewers may benefit from templates instead. Excalicast is not a frame-by-frame character animator; its advantage is turning a real explanation into publish-ready video and knowledge assets without moving through several tools.',
          zh: '课程、架构讲解、数学证明或产品思路的白板讲解视频通常受益于现场节奏：观众一边看到推理展开，一边听讲者说明。需要多语言、严格品牌场景、复用角色和多人审核的营销项目则可能更适合模板。Excalicast 不是逐帧角色动画器；它的优势是把真实讲解变成发布就绪的视频与知识资产，而不必在多个工具间搬运。',
        }],
      },
      {
        heading: { en: 'Run a ten-minute proof before buying', zh: '购买前先做十分钟验证' },
        paragraphs: [{
          en: 'Write a 60-second script containing one title, one diagram, one correction, and one call to action. Build the same clip in two shortlisted tools. Measure setup time, drawing friction, voice synchronization, edit time, caption cleanup, export quality, watermark, and final file options. This small production test is more useful than comparing marketing checkmarks because it exposes the work you repeat on every video.',
          zh: '写一段 60 秒脚本，包含一个标题、一张图、一次修改和一个行动提示；用两款候选工具制作同一片段。记录设置时间、绘制阻力、语音同步、剪辑耗时、字幕清理、导出质量、水印和最终文件选项。这个小型制作测试比比较营销勾选项更有用，因为它会暴露每条视频都要重复的工作。',
        }],
      },
      {
        heading: { en: 'Recommendation for Excalicast audiences', zh: '给 Excalicast 目标用户的建议' },
        paragraphs: [{
          en: 'Teachers, knowledge creators, software architects, and product managers should start with the explanation workflow rather than animation effects. If the work begins with drawing and speaking, Excalicast keeps capture, timeline editing, focus regions, captions, handouts, sharing, and multi-ratio rendering together. If the work begins with a storyboard of reusable characters and branded scenes, choose a template or animation suite and use Excalicast only when a live whiteboard segment is needed.',
          zh: '教师、知识创作者、软件架构师和产品经理应先看讲解工作流，而不是先看动画特效。如果工作从边画边讲开始，Excalicast 可把采集、时间线剪辑、焦点区域、字幕、讲义、分享和多比例渲染放在一起；如果工作从可复用角色与品牌场景的分镜开始，应选择模板或动画套件，只在需要现场白板片段时使用 Excalicast。',
        }],
      },
    ],
    faqs: [
      { q: { en: 'What is the best whiteboard animation software?', zh: '最好的白板动画软件是什么？' }, a: { en: 'For a live narrated whiteboard, Excalicast is a focused option. For asset-based draw-on animation, consider VideoScribe. For templates and broader animation, compare Canva, Powtoon, Animaker, and Renderforest. Teaching collaboration is a separate strength of Explain Everything.', zh: '现场旁白白板可优先考虑 Excalicast；素材式手绘出现动画可看 VideoScribe；模板与更广泛动画可比较 Canva、Powtoon、Animaker 和 Renderforest；教学协作则是 Explain Everything 的独立优势。' } },
      { q: { en: 'Is there free whiteboard animation software?', zh: '有免费的白板动画软件吗？' }, a: { en: 'Several tools offer free entry points or trials, but export resolution, watermarks, asset rights, and commercial-use rules vary. Verify the current official plan before production.', zh: '多款工具提供免费入口或试用，但导出分辨率、水印、素材权利与商业使用规则不同，制作前应核实官网当前套餐。' } },
      { q: { en: 'Does Excalicast animate characters?', zh: 'Excalicast 能制作角色动画吗？' }, a: { en: 'No. Excalicast records and edits live whiteboard and multi-source explanations; choose a character-animation application for frame-by-frame acting and motion.', zh: '不能。Excalicast 用于录制和编辑现场白板及多来源讲解；逐帧角色表演与运动应选择角色动画应用。' } },
      { q: { en: 'Can one whiteboard recording become horizontal and vertical video?', zh: '一段白板录制能同时变成横屏和竖屏吗？' }, a: { en: 'Yes in Excalicast. Its structured whiteboard workflow can render the same project for landscape, portrait, square, feed, or custom dimensions without recording the explanation again.', zh: '可以。Excalicast 的结构化白板工作流可把同一项目渲染成横屏、竖屏、方形、信息流或自定义尺寸，无需重录讲解。' } },
    ],
    related: [
      { type: 'blog', slug: 'whiteboard-animation-and-hand-drawn-explainers' },
      { type: 'compare', slug: 'excalicast-vs-explain-everything' },
      { type: 'use-case', slug: 'record-whiteboard-lecture' },
    ],
  },
];

const BLOG_AUTHOR = {
  name: { en: 'Excalicast Editorial Team', zh: 'Excalicast 编辑团队' },
  url: '/about',
};

const BLOG_EXTRA_SOURCES: Partial<Record<string, BlogEntry['sources']>> = {
  'loom-alternatives-for-whiteboard': [
    { label: { en: 'Loom official product page', zh: 'Loom 官方产品页' }, url: 'https://www.loom.com/' },
    { label: { en: 'Screen Studio official product page', zh: 'Screen Studio 官方产品页' }, url: 'https://screen.studio/' },
  ],
  'how-to-screen-record-on-windows-11': [
    {
      label: { en: 'Microsoft: how to record your screen on Windows 11', zh: 'Microsoft：如何在 Windows 11 上录屏' },
      url: 'https://www.microsoft.com/en-us/windows/learning-center/how-to-record-screen-windows-11',
    },
  ],
  'best-screen-recorder-for-mac': [
    {
      label: { en: 'Apple Support: how to record the screen on Mac', zh: 'Apple 支持：如何在 Mac 上录制屏幕' },
      url: 'https://support.apple.com/en-us/102618',
    },
  ],
  'whiteboard-animation-and-hand-drawn-explainers': [
    {
      label: { en: 'Walt Disney Animation Studios: hand-drawn animation', zh: '华特迪士尼动画工作室：手绘动画' },
      url: 'https://www.disneyanimation.com/process/hand-drawn-animation/',
    },
  ],
  'whiteboard-animation-software-comparison': [
    { label: { en: 'VideoScribe whiteboard animation', zh: 'VideoScribe 白板动画' }, url: 'https://www.videoscribe.co/en/whiteboard-animation/' },
    { label: { en: 'Canva whiteboard animation', zh: 'Canva 白板动画' }, url: 'https://www.canva.com/features/whiteboard-animation/' },
    { label: { en: 'Powtoon whiteboard videos', zh: 'Powtoon 白板视频' }, url: 'https://www.powtoon.com/create/whiteboard-videos' },
    { label: { en: 'Animaker explainer video software', zh: 'Animaker 讲解视频软件' }, url: 'https://www.animaker.com/explainer-video-software' },
    { label: { en: 'Explain Everything official product page', zh: 'Explain Everything 官方产品页' }, url: 'https://explaineverything.com/' },
  ],
};

const BLOG_UPDATED_AT: Partial<Record<string, string>> = {
  'loom-alternatives-for-whiteboard': '2026-09-01',
  'whiteboard-animation-and-hand-drawn-explainers': '2026-09-01',
  'whiteboard-animation-software-comparison': '2026-09-01',
};

export const BLOG_ENTRIES: BlogEntry[] = RAW_BLOG_ENTRIES.map((entry) => ({
  ...entry,
  updatedAt: BLOG_UPDATED_AT[entry.slug] ?? (entry.date > '2026-08-26' ? entry.date : '2026-08-26'),
  author: BLOG_AUTHOR,
  sources: [
    {
      label: { en: 'Excalicast product and data-boundary overview', zh: 'Excalicast 产品与数据边界说明' },
      url: 'https://excalicast.cc/en/about',
    },
    ...(BLOG_EXTRA_SOURCES[entry.slug] ?? []),
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
