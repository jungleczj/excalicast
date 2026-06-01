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
];

export function getUseCaseEntry(slug: string): UseCaseEntry | undefined {
  return USE_CASE_ENTRIES.find((e) => e.slug === slug);
}
