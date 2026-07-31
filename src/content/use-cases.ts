import type { UseCaseEntry } from './types';

/**
 * Scenario landing pages. Each targets an intent query like "how to record a
 * whiteboard lecture". Structure: GEO intro + numbered steps + FAQ.
 */
export const USE_CASE_ENTRIES: UseCaseEntry[] = [
  {
    slug: 'record-whiteboard-lecture',
    title: {
      en: 'How to record a whiteboard lecture (no screen recording)',
      zh: '如何录制白板讲座（无需录屏）',
    },
    description: {
      en: 'Record a whiteboard lecture in your browser with synced voice, then export an MP4 in any aspect ratio. No software, no sign-up.',
      zh: '在浏览器里录制白板讲座，语音同步采集，导出任意比例的 MP4。无需软件、无需注册。',
    },
    intro: {
      en: 'To record a whiteboard lecture with Excalicast, you open the browser app, pick an aspect ratio, draw and speak as you teach, then export an MP4 — the tool captures the operation stream and microphone audio instead of screen pixels, so the recording stays clean even if you switch tabs.',
      zh: '用 Excalicast 录制白板讲座：打开浏览器应用、选好比例、边讲边画边说，然后导出 MP4——工具采集的是操作事件流和麦克风音频而非屏幕像素，即使切换标签页录制也保持干净。',
    },
    steps: [
      {
        title: { en: 'Open the recorder', zh: '打开录制器' },
        body: {
          en: 'Go to excalicast.cc and open the app. No download or sign-up is needed to start recording.',
          zh: '访问 excalicast.cc 打开应用。开始录制无需下载或注册。',
        },
      },
      {
        title: { en: 'Pick an aspect ratio', zh: '选择画幅比例' },
        body: {
          en: 'Choose 16:9 for YouTube, 9:16 for Shorts/TikTok, or 1:1 — a crop frame shows exactly what will be in the video. You can still export other ratios later from the same take.',
          zh: '横屏选 16:9（YouTube），竖屏选 9:16（Shorts/抖音），或选 1:1——裁切框会精确显示视频范围。同一段录制之后还能导出其他比例。',
        },
      },
      {
        title: { en: 'Teach: draw and narrate', zh: '开讲：边画边说' },
        body: {
          en: 'Press record and explain on the whiteboard. Optionally enable the camera bubble for a talking-head overlay. Switching tabs to check notes will not appear in the video.',
          zh: '点击录制，在白板上讲解。可选开启人像气泡做出镜叠加。切到别的标签页看资料也不会出现在视频里。',
        },
      },
      {
        title: { en: 'Export the MP4', zh: '导出 MP4' },
        body: {
          en: 'Stop and export. Video renders locally in your browser via ffmpeg.wasm. Watermarked export is free; a one-time unlock removes the watermark.',
          zh: '停止并导出。视频通过 ffmpeg.wasm 在浏览器本地渲染。带水印导出免费，单次解锁可去水印。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Do I need to install anything to record a lecture?', zh: '录讲座需要安装什么吗？' },
        a: {
          en: 'No. Excalicast runs in the browser (Chrome/Edge). You do not install software or sign up to record and export a watermarked MP4.',
          zh: '不需要。Excalicast 在浏览器（Chrome/Edge）里运行。录制和导出带水印 MP4 无需安装软件或注册。',
        },
      },
      {
        q: { en: 'Can I get subtitles for the lecture?', zh: '讲座能生成字幕吗？' },
        a: {
          en: 'Yes, on the Pro plan. Subtitles are generated with Alibaba Qwen ASR (optimized for Chinese and English) and can be downloaded as SRT or burned into the MP4.',
          zh: '可以，Pro 档支持。字幕由阿里千问 ASR 生成（中英文优化），可下载 SRT 或烧录进 MP4。',
        },
      },
    ],
    related: [
      { type: 'blog', slug: 'record-whiteboard-lectures-online-teaching' },
      { type: 'use-case', slug: 'record-online-course-lesson' },
      { type: 'use-case', slug: 'record-math-tutorial' },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'async-architecture-walkthrough',
    title: {
      en: 'Record an async architecture walkthrough for your team',
      zh: '为团队录制异步架构讲解',
    },
    description: {
      en: 'Replace a live meeting with a recorded architecture walkthrough: draw the system on a whiteboard, narrate the decisions, and share an MP4 or replay link.',
      zh: '用录制的架构讲解替代实时会议：在白板上画出系统、口述决策，分享 MP4 或回放链接。',
    },
    intro: {
      en: 'An async architecture walkthrough is a recorded whiteboard session where you diagram a system and narrate the design decisions so teammates can watch on their own time. Excalicast captures the diagram operations and your voice together, then exports an MP4 or (on Max) a lightweight replay link instead of a heavy video file.',
      zh: '异步架构讲解是一段录制的白板会话：你画出系统结构并口述设计决策，队友可以自行选时观看。Excalicast 把图示操作和你的语音一起采集，然后导出 MP4，或（Max 档）导出轻量回放链接而非笨重的视频文件。',
    },
    steps: [
      {
        title: { en: 'Diagram the system', zh: '画出系统结构' },
        body: {
          en: 'Sketch services, data flow, and boundaries on the Excalidraw canvas as you would in a design review.',
          zh: '像在设计评审里那样，在 Excalidraw 画布上画出服务、数据流和边界。',
        },
      },
      {
        title: { en: 'Narrate the decisions', zh: '口述决策' },
        body: {
          en: 'Record while you explain the trade-offs. The operation stream keeps the diagram crisp; your reasoning is preserved on the audio track.',
          zh: '一边录制一边解释取舍。操作事件流让图示保持清晰，你的推理保留在音轨上。',
        },
      },
      {
        title: { en: 'Share async', zh: '异步分享' },
        body: {
          en: 'Export an MP4 for any channel, or on Max generate a replay link that streams the operation stream + audio (10–20× smaller than a video) for recipients to watch in the browser.',
          zh: '导出 MP4 发到任意渠道，或在 Max 档生成回放链接，传输操作流 + 音频（比视频小 10–20 倍），收件方在浏览器里观看。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Why not just screen-record a Zoom call?', zh: '为什么不直接录屏 Zoom 会议？' },
        a: {
          en: 'Screen recording captures pixels, so any overlapping window or notification ends up in the file and the result is locked to one resolution. Operation-stream capture stays clean and can be re-exported to any aspect ratio.',
          zh: '录屏采集的是像素，任何遮挡窗口或通知都会进文件，结果还锁死在一个分辨率。操作流采集保持干净，并能重导出成任意比例。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'whiteboard-video-for-youtube-shorts',
    title: {
      en: 'Make a whiteboard explainer for YouTube Shorts and TikTok',
      zh: '为 YouTube Shorts 和抖音制作白板讲解视频',
    },
    description: {
      en: 'Record once on a whiteboard and export 9:16 vertical video for Shorts, Reels, and TikTok — plus 16:9 for YouTube — from the same take.',
      zh: '在白板上录一次，从同一段录制导出 9:16 竖屏（Shorts/Reels/抖音）以及 16:9（YouTube）。',
    },
    intro: {
      en: 'To make a whiteboard explainer for short-form video, record a single Excalidraw session in Excalicast and export it as 9:16 for YouTube Shorts, Instagram Reels, and TikTok, and as 16:9 for YouTube — the same take re-renders to each aspect ratio with no re-recording.',
      zh: '制作短视频白板讲解：在 Excalicast 里录一段 Excalidraw 会话，导出 9:16 用于 YouTube Shorts、Instagram Reels 和抖音，导出 16:9 用于 YouTube——同一段录制可重渲染成各比例，无需重录。',
    },
    steps: [
      {
        title: { en: 'Plan a tight 9:16 frame', zh: '规划紧凑的 9:16 画面' },
        body: {
          en: 'Select the 9:16 ratio first so the crop frame guides where you draw; vertical leaves less horizontal room, so keep elements stacked.',
          zh: '先选 9:16 比例，让裁切框引导你作画的位置；竖屏横向空间小，元素尽量竖向堆叠。',
        },
      },
      {
        title: { en: 'Record the explainer', zh: '录制讲解' },
        body: {
          en: 'Narrate concisely. Short-form rewards a single clear idea per video.',
          zh: '简洁口述。短视频适合每条只讲一个清晰要点。',
        },
      },
      {
        title: { en: 'Export every ratio', zh: '导出每个比例' },
        body: {
          en: 'Export 9:16 for Shorts/Reels/TikTok and 16:9 for YouTube from the same recording — one take, every platform.',
          zh: '从同一段录制导出 9:16（Shorts/Reels/抖音）和 16:9（YouTube）——一次录制，覆盖每个平台。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Can one recording become both a Short and a full YouTube video?', zh: '一段录制能同时变成 Shorts 和完整 YouTube 视频吗？' },
        a: {
          en: 'Yes. Excalicast re-renders the same take into 9:16 and 16:9 (and 1:1, 4:5), so you publish to every platform without recording twice.',
          zh: '可以。Excalicast 把同一段录制重渲染成 9:16 和 16:9（以及 1:1、4:5），无需录两次即可发布到每个平台。',
        },
      },
    ],
    related: [
      { type: 'blog', slug: 'repurpose-one-recording-into-shorts-reels' },
      { type: 'blog', slug: 'one-recording-every-aspect-ratio' },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'record-math-tutorial',
    title: {
      en: 'How to record a math tutorial on a whiteboard',
      zh: '如何在白板上录制数学讲题视频',
    },
    description: {
      en: 'Record a math or science tutorial by writing on a whiteboard while narrating, then export an MP4 for YouTube or a vertical Short — no screen recording.',
      zh: '边写边讲录制数学或理科讲题，导出 MP4 发 YouTube 或竖屏 Shorts——无需录屏。',
    },
    intro: {
      en: 'To record a math tutorial, write each step on the Excalicast whiteboard while you narrate the reasoning; it captures the operation stream and your voice and exports a clean MP4 in any aspect ratio, so the equations stay crisp and you can publish both a 16:9 lesson and a 9:16 Short.',
      zh: '录数学讲题：在 Excalicast 白板上一步步书写并口述推理，它采集操作流和你的语音，导出任意比例的干净 MP4，公式始终清晰，既能发 16:9 完整课程也能发 9:16 短视频。',
    },
    steps: [
      {
        title: { en: 'Write the problem', zh: '写出题目' },
        body: {
          en: 'Start with the problem statement on the canvas so viewers have context before you solve it.',
          zh: '先在画布上写出题目，让观众在你解题前有上下文。',
        },
      },
      {
        title: { en: 'Solve step by step, narrating', zh: '逐步解题并口述' },
        body: {
          en: 'Work through each step while explaining out loud. The operation stream keeps handwriting crisp at any zoom.',
          zh: '一步步解，同时出声讲解。操作流让手写在任意缩放下保持清晰。',
        },
      },
      {
        title: { en: 'Export for your platform', zh: '按平台导出' },
        body: {
          en: 'Export 16:9 for YouTube and 9:16 for Shorts/TikTok from the same recording — one solve, multiple posts.',
          zh: '从同一段录制导出 16:9（YouTube）和 9:16（Shorts/抖音）——一次讲解，多处发布。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Will my handwriting stay readable in the video?', zh: '视频里我的手写还清晰吗？' },
        a: {
          en: 'Yes. Because Excalicast re-renders frames from the operation stream rather than capturing screen pixels, handwriting and equations stay crisp at the exported resolution.',
          zh: '清晰。因为 Excalicast 从操作流重新渲染每一帧而非采集屏幕像素，手写和公式在导出分辨率下保持清晰。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'product-demo-for-pm',
    title: {
      en: 'Record a product walkthrough instead of writing a PRD',
      zh: '用录制的需求讲解替代写 PRD',
    },
    description: {
      en: 'Product managers can record a whiteboard walkthrough of a feature with voice, then share an MP4 or replay link so engineering and design align faster.',
      zh: '产品经理可以录制一段带语音的白板需求讲解，分享 MP4 或回放链接，让研发和设计更快对齐。',
    },
    intro: {
      en: 'A product manager can replace a long written PRD with a recorded whiteboard walkthrough: sketch the flow and narrate the intent in Excalicast, which captures the operation stream plus voice and exports an MP4 (or a lightweight replay link on Max) for the team to watch async.',
      zh: '产品经理可以用录制的白板讲解替代冗长的文字 PRD：在 Excalicast 里画出流程并口述意图，它采集操作流 + 语音，导出 MP4（或 Max 档的轻量回放链接）供团队异步观看。',
    },
    steps: [
      {
        title: { en: 'Sketch the user flow', zh: '画出用户流程' },
        body: {
          en: 'Draw screens, states, and edge cases on the canvas the way you would whiteboard a feature.',
          zh: '像白板讨论功能那样，在画布上画出页面、状态和边界情况。',
        },
      },
      {
        title: { en: 'Narrate intent and trade-offs', zh: '口述意图与取舍' },
        body: {
          en: 'Record while explaining why, not just what — the part that usually gets lost in a written doc.',
          zh: '一边录一边解释「为什么」而不只是「是什么」——这正是文字文档常丢失的部分。',
        },
      },
      {
        title: { en: 'Share with the team', zh: '分享给团队' },
        body: {
          en: 'Export an MP4 for your docs, or on Max generate a replay link engineers and designers can open in the browser.',
          zh: '导出 MP4 放进文档，或在 Max 档生成研发与设计能在浏览器打开的回放链接。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Why is a recorded walkthrough better than a written PRD?', zh: '录制讲解为什么比文字 PRD 好？' },
        a: {
          en: 'A walkthrough preserves the reasoning and visual flow in your own voice, which text often loses. It reduces back-and-forth and aligns engineering and design faster, while still re-exportable to any aspect ratio for wider sharing.',
          zh: '讲解用你自己的声音保留了推理和视觉流程，这些文字常常丢失。它减少来回沟通、让研发与设计更快对齐，同时仍可重导出成任意比例便于更广分享。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'record-online-course-lesson',
    title: {
      en: 'Record an online course lesson on a whiteboard',
      zh: '在白板上录制在线课程',
    },
    description: {
      en: 'Create online course lessons by recording a whiteboard with synced voice and subtitles, then export MP4 in the ratio your platform needs.',
      zh: '通过录制白板 + 同步语音和字幕制作在线课程，按平台所需比例导出 MP4。',
    },
    intro: {
      en: 'To record an online course lesson, teach on the Excalicast whiteboard while it captures your voice and actions; it exports a narrated MP4 with optional auto subtitles (Pro), so each lesson is clean, captioned, and ready for your course platform — no screen-recording software required.',
      zh: '录制在线课程：在 Excalicast 白板上授课，它同步采集你的语音和操作，导出带旁白的 MP4，并可选自动字幕（Pro），每节课干净、有字幕、可直接上课程平台——无需录屏软件。',
    },
    steps: [
      {
        title: { en: 'Outline the lesson on the canvas', zh: '在画布上列出课纲' },
        body: {
          en: 'Lay out the lesson structure so the recording follows a clear arc.',
          zh: '先布置好这节课的结构，让录制有清晰脉络。',
        },
      },
      {
        title: { en: 'Teach and record', zh: '授课并录制' },
        body: {
          en: 'Explain on the whiteboard. Enable the camera bubble if you want a talking-head presence.',
          zh: '在白板上讲解。想要出镜可开启人像气泡。',
        },
      },
      {
        title: { en: 'Add subtitles and export', zh: '加字幕并导出' },
        body: {
          en: 'On Pro, generate subtitles (Alibaba Qwen ASR), then export the MP4 in your platform’s aspect ratio.',
          zh: '在 Pro 档生成字幕（阿里千问 ASR），再按平台比例导出 MP4。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Can I add captions to course videos?', zh: '课程视频能加字幕吗？' },
        a: {
          en: 'Yes. On the Pro plan Excalicast generates subtitles with Alibaba Qwen ASR (Chinese & English), which you can download as SRT or burn into the MP4 — useful for accessibility and watch-time.',
          zh: '可以。Pro 档用阿里千问 ASR 生成字幕（中英文），可下载 SRT 或烧录进 MP4——有助于无障碍和完播率。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'system-design-explainer',
    title: {
      en: 'Record a system design explainer video',
      zh: '录制系统设计讲解视频',
    },
    description: {
      en: 'Diagram a system on a whiteboard and narrate the design decisions, then export an MP4 — ideal for interviews prep, docs, and team onboarding.',
      zh: '在白板上画出系统并口述设计决策，导出 MP4——适合面试准备、技术文档和团队上手。',
    },
    intro: {
      en: 'To record a system design explainer, diagram the architecture on the Excalicast whiteboard while narrating the trade-offs; it captures the operation stream plus voice so the diagram stays crisp, and exports an MP4 you can use for interview prep, documentation, or onboarding.',
      zh: '录制系统设计讲解：在 Excalicast 白板上画出架构并口述取舍，它采集操作流 + 语音让图示保持清晰，导出 MP4 可用于面试准备、技术文档或团队上手。',
    },
    steps: [
      {
        title: { en: 'Draw the architecture', zh: '画出架构' },
        body: {
          en: 'Sketch services, databases, queues, and data flow as you would on a real design-review whiteboard.',
          zh: '像真实设计评审白板那样画出服务、数据库、队列和数据流。',
        },
      },
      {
        title: { en: 'Narrate the decisions', zh: '口述决策' },
        body: {
          en: 'Explain scaling, consistency, and failure modes out loud while annotating the diagram.',
          zh: '一边标注图示，一边出声解释扩展性、一致性和故障模式。',
        },
      },
      {
        title: { en: 'Export and share', zh: '导出并分享' },
        body: {
          en: 'Export an MP4 for your notes or team. On Max, a replay link keeps file size tiny for async review.',
          zh: '导出 MP4 给自己或团队。Max 档的回放链接让文件极小，便于异步评审。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'Is this good for system design interview prep?', zh: '这适合系统设计面试准备吗？' },
        a: {
          en: 'Yes. Recording yourself diagramming and explaining a system is a strong way to rehearse: you get a clean, re-watchable video, and the operation-stream capture keeps the diagram readable at any resolution.',
          zh: '适合。把自己画系统、讲系统录下来是很好的演练方式：得到一段干净、可回看的视频，操作流采集让图示在任意分辨率下都清晰可读。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'add-subtitles-to-whiteboard-video',
    title: {
      en: 'How to add subtitles to a whiteboard video',
      zh: '如何给白板视频加字幕',
    },
    description: {
      en: 'Record a whiteboard video and auto-generate subtitles with Alibaba Qwen ASR (Chinese & English), then download SRT or burn captions into the MP4.',
      zh: '录制白板视频并用阿里千问 ASR（中英文）自动生成字幕，下载 SRT 或把字幕烧录进 MP4。',
    },
    intro: {
      en: 'To add subtitles to a whiteboard video, record in Excalicast and generate captions on the Pro plan with Alibaba Qwen ASR (optimized for Chinese and English); you can download the result as an SRT file or burn the subtitles directly into the exported MP4.',
      zh: '给白板视频加字幕：在 Excalicast 录制，在 Pro 档用阿里千问 ASR（中英文优化）生成字幕；可下载为 SRT 文件，或把字幕直接烧录进导出的 MP4。',
    },
    steps: [
      {
        title: { en: 'Record your whiteboard video', zh: '录制白板视频' },
        body: {
          en: 'Capture the explainer with voice as usual — subtitles are generated from the recorded audio.',
          zh: '照常带语音录制讲解——字幕从录制的音频生成。',
        },
      },
      {
        title: { en: 'Generate subtitles (Pro)', zh: '生成字幕（Pro）' },
        body: {
          en: 'On the Pro plan, run subtitle generation; Alibaba Qwen ASR transcribes with timestamps aligned to your recording.',
          zh: '在 Pro 档运行字幕生成；阿里千问 ASR 转写并对齐到你录制的时间轴。',
        },
      },
      {
        title: { en: 'Download SRT or burn in', zh: '下载 SRT 或烧录' },
        body: {
          en: 'Download the SRT to edit elsewhere, or burn the captions into the MP4 for platforms that need hard subtitles.',
          zh: '下载 SRT 在别处编辑，或把字幕烧录进 MP4，适配需要硬字幕的平台。',
        },
      },
    ],
    faqs: [
      {
        q: { en: 'What language does the subtitle ASR support?', zh: '字幕 ASR 支持哪些语言？' },
        a: {
          en: 'Excalicast uses Alibaba Qwen ASR (DashScope), which is optimized for Chinese and English and returns timestamps aligned to the recording, available on the Pro plan.',
          zh: 'Excalicast 使用阿里千问 ASR（DashScope），针对中英文优化并返回与录制对齐的时间戳，Pro 档可用。',
        },
      },
    ],
    updatedAt: '2026-06-01',
  },
  {
    slug: 'record-edit-publish-whiteboard-video',
    title: {
      en: 'Record, edit, and prepare a whiteboard video for every platform',
      zh: '录制、剪辑并为多平台准备白板视频',
    },
    description: {
      en: 'Capture a whiteboard, tab, window, or desktop, edit online, refine Autozoom, add captions or handouts, and render publish-ready video formats.',
      zh: '采集白板、标签页、窗口或桌面，在线剪辑、优化 Autozoom、添加字幕或讲义，并渲染发布就绪的视频格式。',
    },
    intro: {
      en: 'Excalicast brings multi-source capture, browser timeline editing, ChatCut-assisted cuts, editable Autozoom, captions, structured handouts, and multi-dimension export into one workflow. The result is a set of publish-ready files and eligible share links that you control; Excalicast does not post directly to third-party social accounts.',
      zh: 'Excalicast 把多源采集、浏览器时间线剪辑、ChatCut 辅助裁切、可编辑 Autozoom、字幕、结构化讲义和多尺寸导出放进一条工作流。最终得到由你控制的发布就绪文件和符合权益的分享链接；Excalicast 不会直接发布到第三方社交账号。',
    },
    directAnswer: {
      en: 'To turn a whiteboard explanation into publish-ready content, capture the right source once, refine it on the Excalicast timeline, add focus and supporting assets, then render the dimensions each channel needs. You download or share the finished assets and publish them yourself.',
      zh: '要把白板讲解变成发布就绪内容，只需采集一次正确来源，在 Excalicast 时间线上优化，补充焦点与配套资产，再渲染各渠道需要的尺寸。你可以下载或分享成品，并自行完成发布。',
    },
    bestFor: [
      {
        en: 'Teachers turning a lesson into a full video, a vertical recap, captions, and a handout.',
        zh: '把一堂课转成完整视频、竖屏回顾、字幕与讲义的教师。',
      },
      {
        en: 'Knowledge creators producing visual explanations for YouTube, TikTok, Shorts, Reels, and feed formats.',
        zh: '为 YouTube、抖音、TikTok、Shorts、Reels 和信息流制作视觉讲解的知识创作者。',
      },
      {
        en: 'Architects and product managers recording diagrams, app flows, windows, or complete desktop walkthroughs.',
        zh: '录制图示、应用流程、窗口或完整桌面讲解的架构师与产品经理。',
      },
    ],
    notBestFor: [
      {
        en: 'Heavy multi-track productions that need advanced compositing, color grading, or a full desktop editing suite.',
        zh: '需要高级合成、调色或完整桌面剪辑套件的重型多轨制作。',
      },
      {
        en: 'Workflows that require a service to sign in to and post automatically on third-party social accounts.',
        zh: '要求服务登录并自动发布到第三方社交账号的工作流。',
      },
      {
        en: 'Live collaborative classroom whiteboarding with several simultaneous editors.',
        zh: '需要多人同时编辑的实时协作课堂白板。',
      },
    ],
    workflow: [
      {
        title: { en: 'Choose the source', zh: '选择录制来源' },
        body: {
          en: 'Start with the Excalidraw whiteboard, the current browser tab, a specific app window, or the entire desktop. Pick only what the final explanation needs.',
          zh: '从 Excalidraw 白板、当前浏览器标签页、指定应用窗口或整个桌面开始，只选择最终讲解真正需要的内容。',
        },
      },
      {
        title: { en: 'Frame the output', zh: '确定成品取景' },
        body: {
          en: 'Set a landscape, portrait, square, feed, or custom frame and confirm the crop. Framing can be adjusted again in the export workspace.',
          zh: '设置横屏、竖屏、方形、信息流或自定义画幅并确认裁切；在导出工作区仍可继续调整取景。',
        },
      },
      {
        title: { en: 'Add voice and optional camera', zh: '加入语音与可选摄像头' },
        body: {
          en: 'Select the microphone and, when useful, add a camera bubble. Check the framing before recording so neither the subject nor the presenter is obscured.',
          zh: '选择麦克风，并在需要时加入摄像头画面。录制前检查构图，避免主体或讲解者被遮挡。',
        },
      },
      {
        title: { en: 'Record the explanation once', zh: '一次录好讲解' },
        body: {
          en: 'Draw, demonstrate, and narrate in one take. Whiteboard mode captures Excalidraw events; tab, window, and desktop modes capture the selected display source.',
          zh: '在一段录制中完成绘制、演示和旁白。白板模式采集 Excalidraw 事件；标签页、窗口和桌面模式采集所选显示源。',
        },
      },
      {
        title: { en: 'Trim and structure the timeline', zh: '裁剪并整理时间线' },
        body: {
          en: 'Remove rough starts and endings, split clips at decision points, delete unwanted ranges, and preview the kept sequence in the browser.',
          zh: '删除不理想的开头和结尾，在关键位置分割片段，移除不需要的区间，并在浏览器中预览保留序列。',
        },
      },
      {
        title: { en: 'Review ChatCut-assisted edits', zh: '检查 ChatCut 辅助剪辑' },
        body: {
          en: 'Use ChatCut to propose silence-aware cuts aligned with scene boundaries, then review the proposal before applying it. It assists the edit rather than replacing editorial judgment.',
          zh: '使用 ChatCut 提出结合静音与场景边界的裁切建议，并在应用前检查结果。它辅助剪辑，不替代人工判断。',
        },
      },
      {
        title: { en: 'Edit Autozoom focus regions', zh: '编辑 Autozoom 焦点区域' },
        body: {
          en: 'Add or adjust focus regions on the timeline, including their center, timing, and magnification, so viewers can follow important strokes, controls, or diagram areas.',
          zh: '在时间线上添加或调整焦点区域，包括中心、时间和倍率，让观众跟上重要笔画、控件或图示区域。',
        },
      },
      {
        title: { en: 'Create captions and knowledge assets', zh: '生成字幕与知识资产' },
        body: {
          en: 'On eligible tiers, generate editable captions and export SRT, VTT, or ASS; Max can also create timestamped chapters and structured handouts in supported formats.',
          zh: '符合套餐权益时，可生成可编辑字幕并导出 SRT、VTT 或 ASS；Max 还可创建带时间戳章节和支持格式的结构化讲义。',
        },
      },
      {
        title: { en: 'Render each publish-ready format', zh: '渲染各类发布就绪格式' },
        body: {
          en: 'Render landscape for long-form video, portrait for TikTok, Shorts, or Reels, square or 4:5 for feeds, and custom dimensions when a channel requires them.',
          zh: '渲染横屏长视频、适合抖音/TikTok/Shorts/Reels 的竖屏、方形或 4:5 信息流，并在渠道需要时使用自定义尺寸。',
        },
      },
      {
        title: { en: 'Download or share, then publish', zh: '下载或分享，再自行发布' },
        body: {
          en: 'Download the finished files or create an eligible playback link. Upload the files to the destination accounts yourself, keeping final publishing and account access under your control.',
          zh: '下载成品文件或创建符合权益的播放链接。由你自行把文件上传到目标账号，最终发布与账号访问始终由你控制。',
        },
      },
    ],
    facts: [
      {
        label: { en: 'Capture sources', zh: '采集来源' },
        value: {
          en: 'Excalidraw whiteboard, browser tab, app window, or desktop, with microphone and optional camera.',
          zh: 'Excalidraw 白板、浏览器标签页、应用窗口或桌面，并可配合麦克风与摄像头。',
        },
      },
      {
        label: { en: 'Editing', zh: '剪辑能力' },
        value: {
          en: 'Browser timeline with trim, split, delete, ChatCut-assisted suggestions, and editable Autozoom regions.',
          zh: '浏览器时间线支持裁剪、分割、删除、ChatCut 辅助建议与可编辑 Autozoom 区域。',
        },
      },
      {
        label: { en: 'Video dimensions', zh: '视频尺寸' },
        value: {
          en: 'Landscape, portrait, square, feed, and custom pixel dimensions, including 16:9, 9:16, 1:1, and 4:5.',
          zh: '横屏、竖屏、方形、信息流和自定义像素尺寸，包括 16:9、9:16、1:1 与 4:5。',
        },
      },
      {
        label: { en: 'Supporting outputs', zh: '配套输出' },
        value: {
          en: 'Eligible tiers add captions, subtitle files, chapters, structured handouts, cloud backup, and playback links.',
          zh: '符合套餐权益时可增加字幕、字幕文件、章节、结构化讲义、云备份和播放链接。',
        },
      },
      {
        label: { en: 'Publishing boundary', zh: '发布边界' },
        value: {
          en: 'Excalicast creates publish-ready assets but does not upload them directly to third-party social accounts.',
          zh: 'Excalicast 生成发布就绪资产，但不会直接上传到第三方社交账号。',
        },
      },
    ],
    limitations: [
      {
        en: 'ChatCut proposes edits that should be reviewed; it does not promise a finished film without creator judgment.',
        zh: 'ChatCut 提供需要检查的剪辑建议，不承诺无需创作者判断即可全自动成片。',
      },
      {
        en: 'Captions, structured handouts, cloud backup, watermark-free output, and share links depend on Free, one-time, Pro, or Max entitlements.',
        zh: '字幕、结构化讲义、云备份、无水印输出和分享链接取决于 Free、单次购买、Pro 或 Max 权益。',
      },
      {
        en: 'Local-first does not mean every optional feature stays local: selected cloud features send only the data needed for that feature.',
        zh: '本地优先不代表所有可选功能都完全本地运行；主动选择的云功能会发送完成该功能所需的数据。',
      },
    ],
    faqs: [
      {
        q: { en: 'Can one recording produce videos for YouTube, TikTok, Shorts, and Reels?', zh: '一段录制能生成 YouTube、抖音、TikTok、Shorts 和 Reels 视频吗？' },
        a: {
          en: 'Yes. Excalicast can render the recording into landscape, portrait, square, feed, and custom dimensions. It creates the files for you to publish; it does not post to those accounts directly.',
          zh: '可以。Excalicast 可把录制渲染成横屏、竖屏、方形、信息流和自定义尺寸。它生成由你发布的文件，不会直接发布到这些账号。',
        },
      },
      {
        q: { en: 'Can I record something other than the whiteboard?', zh: '除了白板还能录制其他内容吗？' },
        a: {
          en: 'Yes. You can choose a browser tab, an app window, or the entire desktop, then use the same export workspace to edit and render the result.',
          zh: '可以。你可以选择浏览器标签页、应用窗口或整个桌面，再使用同一个导出工作区剪辑和渲染结果。',
        },
      },
      {
        q: { en: 'Does automatic editing remove the need to review the timeline?', zh: '自动剪辑后还需要检查时间线吗？' },
        a: {
          en: 'You should still review it. ChatCut assists with silence- and scene-aware cut proposals, while the creator decides what belongs in the final explanation.',
          zh: '仍然需要检查。ChatCut 辅助提出结合静音与场景的裁切建议，最终讲解保留什么仍由创作者决定。',
        },
      },
      {
        q: { en: 'Does Excalicast publish directly to social networks?', zh: 'Excalicast 会直接发布到社交网络吗？' },
        a: {
          en: 'No. It prepares downloadable files and eligible share links. You upload the finished file to each publishing account yourself.',
          zh: '不会。它准备可下载文件和符合权益的分享链接，你需要自行把成品上传到各发布账号。',
        },
      },
    ],
    sources: [
      {
        label: { en: 'Excalicast product overview', zh: 'Excalicast 产品概览' },
        url: 'https://excalicast.cc/en',
      },
      {
        label: { en: 'Excalicast plans and feature boundaries', zh: 'Excalicast 套餐与功能边界' },
        url: 'https://excalicast.cc/en/pricing',
      },
    ],
    verifiedAt: '2026-07-30',
    ctaPreset: {
      label: { en: 'Start the end-to-end workflow', zh: '开始端到端制作流程' },
      href: '/app?source=whiteboard',
    },
    related: [
      { type: 'compare', slug: 'excalicast-vs-excalicord' },
      { type: 'compare', slug: 'excalicast-vs-excalirec' },
      { type: 'blog', slug: 'one-recording-every-aspect-ratio' },
      { type: 'use-case', slug: 'add-subtitles-to-whiteboard-video' },
    ],
    updatedAt: '2026-07-30',
  },
];

export function getUseCaseEntry(slug: string): UseCaseEntry | undefined {
  return USE_CASE_ENTRIES.find((e) => e.slug === slug);
}
