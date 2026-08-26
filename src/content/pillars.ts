import type { PillarEntry } from './types';

const PRODUCT_SOURCE = {
  label: { en: 'Excalicast product and data-boundary overview', zh: 'Excalicast 产品与数据边界说明' },
  url: 'https://excalicast.cc/en/about',
};

export const PILLAR_ENTRIES: PillarEntry[] = [
  {
    slug: 'excalidraw-recorder',
    title: { en: 'Excalidraw recorder for clear, editable video explanations', zh: 'Excalidraw 录制工具：把白板讲解变成可编辑视频' },
    description: {
      en: 'Record Excalidraw-style whiteboard operations with voice, edit the explanation in a browser timeline, and export it for multiple video formats.',
      zh: '录制 Excalidraw 风格白板操作与语音，在浏览器时间线中编辑，并为多种视频尺寸导出。',
    },
    intro: {
      en: 'Excalicast is an Excalidraw recorder for people who need more than a raw screen capture: it keeps the whiteboard explanation as operations plus audio, then turns that source into editable, publish-ready outputs.',
      zh: 'Excalicast 是面向完整讲解工作流的 Excalidraw 录制工具：它把白板操作与语音保留下来，再将同一来源编辑并导出为发布就绪的内容。',
    },
    directAnswer: {
      en: 'To record an Excalidraw explanation, open the whiteboard source, select a frame, record the drawing operations with narration, then trim and export the result. Excalicast preserves the whiteboard operation stream, so the same take can be edited and rendered again instead of becoming one fixed screen recording.',
      zh: '录制 Excalidraw 讲解时，先打开白板来源并选择画幅，再同步记录绘制操作与旁白，最后剪辑并导出。Excalicast 保留白板操作流，因此同一段录制可以继续编辑和重新渲染，而不是变成一段固定录屏。',
    },
    body: [
      {
        heading: { en: 'What an Excalidraw recorder should preserve', zh: 'Excalidraw 录制真正应该保留什么' },
        paragraphs: [{
          en: 'A useful recording preserves the order of the explanation: which shape appeared, when attention moved, and what the narrator said. For the whiteboard source, Excalicast records those operations and microphone audio as the editable source of the finished video.',
          zh: '有用的录制应保留讲解顺序：哪个图形何时出现、注意力何时转移、讲解者说了什么。对于白板来源，Excalicast 将这些操作和麦克风音频保留为成片的可编辑来源。',
        }],
      },
      {
        heading: { en: 'From recording to a reusable explanation', zh: '从录制到可复用讲解' },
        paragraphs: [{
          en: 'After capture, the browser timeline can trim, split, delete, and adjust Autozoom focus regions. Captions, outlines, handouts, and share links are available where the selected plan supports them. Direct posting to third-party social accounts is not claimed.',
          zh: '录制完成后，可在浏览器时间线里裁剪、分割、删除并调整 Autozoom 焦点区域。支持的套餐还可生成字幕、大纲、讲义和分享链接；本站不宣称直接发布到第三方社交账号。',
        }],
      },
      {
        heading: { en: 'When to use a screen source instead', zh: '什么时候应该改用屏幕来源' },
        paragraphs: [{
          en: 'Use the whiteboard source when the explanation itself is drawn on the canvas. Select a browser tab, app window, or desktop source when the subject is another application. Those screen sources capture displayed content; the whiteboard operation-stream advantage applies specifically to the whiteboard source.',
          zh: '当讲解主体发生在画布上时使用白板来源；当主体是其他应用时选择浏览器标签页、应用窗口或桌面来源。后者采集显示内容，白板操作流的优势只适用于白板来源。',
        }],
      },
    ],
    workflow: [
      { title: { en: 'Choose the whiteboard source', zh: '选择白板来源' }, body: { en: 'Start without an account and select the whiteboard recording mode.', zh: '无需账号即可开始，并选择白板录制模式。' } },
      { title: { en: 'Set the output frame', zh: '设置输出画幅' }, body: { en: 'Choose landscape, portrait, square, feed, or custom dimensions before recording.', zh: '录制前选择横屏、竖屏、方形、信息流或自定义尺寸。' } },
      { title: { en: 'Draw and narrate', zh: '绘制并讲解' }, body: { en: 'Record canvas operations, voice, and optional camera while explaining.', zh: '讲解时同步记录画布操作、语音和可选摄像头。' } },
      { title: { en: 'Edit and export', zh: '编辑并导出' }, body: { en: 'Refine the timeline and render the format required by the destination.', zh: '整理时间线，再按目标平台需要的格式渲染导出。' } },
    ],
    facts: [
      { label: { en: 'Whiteboard engine', zh: '白板引擎' }, value: { en: 'The product uses an Excalidraw-based canvas experience.', zh: '产品使用基于 Excalidraw 的画布体验。' } },
      { label: { en: 'Primary source', zh: '核心来源' }, value: { en: 'Whiteboard operations and narration remain the editable recording source.', zh: '白板操作与旁白作为可编辑的录制来源保留。' } },
      { label: { en: 'Primary CTA', zh: '主要操作' }, value: { en: 'Start recording in the browser; no software installation is required.', zh: '直接在浏览器开始录制，无需安装软件。' } },
    ],
    limitations: [
      { en: 'Operation-stream capture applies to the built-in whiteboard source, not arbitrary third-party app windows.', zh: '操作流采集适用于内置白板来源，不适用于任意第三方应用窗口。' },
      { en: 'Advanced captions, handouts, cloud backup, and sharing depend on the selected plan.', zh: '高级字幕、讲义、云备份和分享能力取决于所选套餐。' },
    ],
    sources: [
      { label: { en: 'Excalidraw open-source project', zh: 'Excalidraw 开源项目' }, url: 'https://github.com/excalidraw/excalidraw' },
      PRODUCT_SOURCE,
    ],
    verifiedAt: '2026-08-26',
    updatedAt: '2026-08-26',
    faqs: [
      { q: { en: 'Does Excalidraw include video recording by itself?', zh: 'Excalidraw 自带视频录制吗？' }, a: { en: 'The open-source Excalidraw project is the canvas foundation. Excalicast adds a separate recording, editing, and export workflow around an Excalidraw-based whiteboard.', zh: '开源 Excalidraw 是画布基础；Excalicast 在基于 Excalidraw 的白板外围增加独立的录制、编辑和导出工作流。' } },
      { q: { en: 'Can I export vertical video?', zh: '可以导出竖屏视频吗？' }, a: { en: 'Yes. The recording workspace supports landscape, portrait, square, feed, and custom dimensions.', zh: '可以。录制工作区支持横屏、竖屏、方形、信息流和自定义尺寸。' } },
    ],
    related: [
      { type: 'pillar', slug: 'whiteboard-recorder' },
      { type: 'pillar', slug: 'event-based-recording' },
      { type: 'use-case', slug: 'record-excalidraw-to-video' },
    ],
    ctaPreset: { label: { en: 'Record an Excalidraw explanation', zh: '开始录制 Excalidraw 讲解' }, href: '/app?source=whiteboard' },
  },
  {
    slug: 'whiteboard-recorder',
    title: { en: 'Online whiteboard recorder for visual explanations', zh: '在线白板录制工具：录制清晰的视觉讲解' },
    description: {
      en: 'Record a whiteboard with voice, edit the timeline, add captions, and export one visual explanation for multiple destinations.',
      zh: '录制白板与语音，编辑时间线、添加字幕，并将同一段视觉讲解导出到多个平台。',
    },
    intro: {
      en: 'An online whiteboard recorder turns drawing, timing, and narration into a video explanation. Excalicast extends that workflow through browser editing, editable focus regions, captions, handouts, and multi-format exports.',
      zh: '在线白板录制工具把绘制、节奏和旁白变成视频讲解。Excalicast 进一步提供浏览器剪辑、可编辑焦点、字幕、讲义和多格式导出。',
    },
    directAnswer: {
      en: 'A whiteboard recorder captures a visual explanation while it is being drawn and narrated. Excalicast is designed for the complete workflow: capture the whiteboard source, refine the recording on a timeline, and render it into the dimensions and supporting assets needed for teaching, product communication, or creator publishing.',
      zh: '白板录制工具会在绘制和讲解发生时捕捉完整的视觉解释。Excalicast 面向完整流程：采集白板来源、在时间线上整理录制，再按教学、产品沟通或内容发布所需的尺寸和配套素材导出。',
    },
    body: [
      {
        heading: { en: 'Who benefits from a whiteboard recorder', zh: '谁适合使用白板录制工具' },
        paragraphs: [{ en: 'Teachers can record derivations and lessons; architects can explain system diagrams; product teams can preserve flows and decisions; creators can turn one visual explanation into long-form and short-form versions.', zh: '教师可以录制推导与课程，架构师可以讲解系统图，产品团队可以保留流程与决策，创作者则能把同一段视觉讲解变成长视频和短视频版本。' }],
      },
      {
        heading: { en: 'Capture is only the first step', zh: '采集只是第一步' },
        paragraphs: [{ en: 'A publish-ready workflow also needs trimming, attention control, captions, reframing, export, and a place to find the source later. Excalicast keeps those stages around the same recording instead of sending users through unrelated desktop tools.', zh: '发布就绪的工作流还需要裁剪、注意力控制、字幕、重新构图、导出以及后续找回来源。Excalicast 围绕同一段录制保留这些阶段，减少在多个无关桌面工具间迁移。' }],
      },
      {
        heading: { en: 'Local-first with explicit cloud boundaries', zh: '本地优先，并明确云端边界' },
        paragraphs: [{ en: 'Core recording and local rendering are designed to happen in the browser. Features such as caption generation, cloud backup, handouts, or share links may use network services when the user selects an eligible plan and invokes them.', zh: '核心录制与本地渲染设计为在浏览器中完成。字幕生成、云备份、讲义或分享链接等能力会在用户选择支持的套餐并主动调用时使用网络服务。' }],
      },
    ],
    workflow: [
      { title: { en: 'Frame the explanation', zh: '确定讲解画幅' }, body: { en: 'Pick the target ratio and keep important drawing inside the visible frame.', zh: '选择目标比例，并让关键绘制内容处于可见画幅内。' } },
      { title: { en: 'Record voice and visuals', zh: '录制语音与视觉内容' }, body: { en: 'Draw, speak, and optionally include a camera bubble.', zh: '一边绘制一边讲解，并可选择加入摄像头气泡。' } },
      { title: { en: 'Shape the timeline', zh: '整理时间线' }, body: { en: 'Trim dead time, split sections, and adjust editable Autozoom regions.', zh: '裁掉停顿、分割段落并调整可编辑 Autozoom 区域。' } },
      { title: { en: 'Prepare the deliverables', zh: '准备交付素材' }, body: { en: 'Export video and, where available, captions, outlines, handouts, or a share link.', zh: '导出视频，并在套餐支持时生成字幕、大纲、讲义或分享链接。' } },
    ],
    facts: [
      { label: { en: 'Runs in', zh: '运行环境' }, value: { en: 'A modern desktop browser.', zh: '现代桌面浏览器。' } },
      { label: { en: 'Recording sources', zh: '录制来源' }, value: { en: 'Whiteboard, browser tab, app window, or desktop.', zh: '白板、浏览器标签页、应用窗口或桌面。' } },
      { label: { en: 'Output strategy', zh: '输出策略' }, value: { en: 'One source can be rendered for several standard or custom dimensions.', zh: '同一来源可渲染为多种标准或自定义尺寸。' } },
    ],
    limitations: [
      { en: 'Excalicast is not a live classroom collaboration platform.', zh: 'Excalicast 不是实时课堂协作平台。' },
      { en: 'It is focused on visual explainers, not heavy multi-track professional post-production.', zh: '它聚焦视觉讲解，不面向重型多轨专业后期制作。' },
    ],
    sources: [
      { label: { en: 'MDN: MediaRecorder API', zh: 'MDN：MediaRecorder API' }, url: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder' },
      PRODUCT_SOURCE,
    ],
    verifiedAt: '2026-08-26',
    updatedAt: '2026-08-26',
    faqs: [
      { q: { en: 'Do I need to install an app?', zh: '需要安装应用吗？' }, a: { en: 'No installation is required for the web workflow. Open Excalicast in a supported desktop browser and start from the recording workspace.', zh: 'Web 工作流无需安装应用。在支持的桌面浏览器中打开 Excalicast 即可进入录制工作区。' } },
      { q: { en: 'Is a whiteboard recorder the same as a screen recorder?', zh: '白板录制和屏幕录制一样吗？' }, a: { en: 'Not necessarily. A screen source captures displayed pixels. Excalicast can do that when selected, while its built-in whiteboard source can preserve drawing operations as a structured event stream.', zh: '不完全一样。屏幕来源采集显示像素；Excalicast 在选择屏幕来源时也会这样做，但其内置白板来源可以将绘制操作保留为结构化事件流。' } },
    ],
    related: [
      { type: 'pillar', slug: 'excalidraw-recorder' },
      { type: 'pillar', slug: 'event-based-recording' },
      { type: 'use-case', slug: 'record-edit-publish-whiteboard-video' },
    ],
    ctaPreset: { label: { en: 'Start a whiteboard recording', zh: '开始白板录制' }, href: '/app?source=whiteboard' },
  },
  {
    slug: 'event-based-recording',
    title: { en: 'Event-based recording: keep the explanation, not just pixels', zh: '事件式录制：保留讲解过程，而不只是像素' },
    description: {
      en: 'Learn how Excalicast records whiteboard operations as an event stream, what that enables, and where ordinary screen capture is still used.',
      zh: '了解 Excalicast 如何把白板操作记录为事件流、它能带来什么，以及哪些场景仍使用普通屏幕采集。',
    },
    intro: {
      en: 'Event-based recording is Excalicast’s name for preserving the ordered whiteboard operations behind an explanation together with its timing and audio, rather than treating the finished display pixels as the only source.',
      zh: '事件式录制是 Excalicast 对一种白板录制方式的命名：它把讲解背后的有序白板操作、时间和音频保留下来，而不是只保存最终显示像素。',
    },
    directAnswer: {
      en: 'In Excalicast, event-based recording means the built-in whiteboard source stores drawing operations and timing as a structured stream alongside narration. The stream can be replayed and rendered again, which supports editable framing and multiple output dimensions. This term describes Excalicast’s whiteboard workflow; it is not a claim that every screen source is event-based.',
      zh: '在 Excalicast 中，事件式录制指内置白板来源把绘制操作及其时间记录为结构化流，并与旁白同步保存。该操作流可以重放和重新渲染，因此支持可编辑构图和多种输出尺寸。这个术语描述的是 Excalicast 的白板工作流，并不意味着所有屏幕来源都是事件式录制。',
    },
    body: [
      {
        heading: { en: 'Pixels versus operations', zh: '像素与操作的区别' },
        paragraphs: [{ en: 'A conventional display capture receives a video stream of what was presented on a selected screen surface. An operation stream instead records meaningful canvas changes—such as adding or moving whiteboard elements—and replays those changes for rendering.', zh: '传统显示采集接收的是所选屏幕表面呈现的视频流；操作流则记录有意义的画布变化，例如添加或移动白板元素，并在渲染时重放这些变化。' }],
      },
      {
        heading: { en: 'What operation streams enable', zh: '操作流能带来什么' },
        paragraphs: [{ en: 'Because the whiteboard source remains structured, the export pipeline can render it into another frame instead of stretching one baked video. Editing can also refer to the explanation’s timeline and focus regions rather than only a flat pixel track.', zh: '由于白板来源保持结构化，导出管线可以把它渲染到另一个画幅，而不是拉伸一段已经烤死的视频。编辑也可以围绕讲解时间线和焦点区域展开，而不只面对一条扁平像素轨道。' }],
      },
      {
        heading: { en: 'Boundaries matter', zh: '边界同样重要' },
        paragraphs: [{ en: 'Browser tabs, app windows, and desktops are different sources. When users choose them, Excalicast relies on browser display-capture capabilities. Marketing and schema must keep that distinction explicit so the operation-stream claim is never applied to arbitrary screen content.', zh: '浏览器标签页、应用窗口和桌面属于不同来源。用户选择这些来源时，Excalicast 依赖浏览器显示采集能力。营销文案和 Schema 必须明确这一区别，不能把操作流表述套用到任意屏幕内容。' }],
      },
    ],
    workflow: [
      { title: { en: 'Record operations', zh: '记录操作' }, body: { en: 'Capture ordered whiteboard changes with timestamps.', zh: '按时间记录有序的白板变化。' } },
      { title: { en: 'Synchronize narration', zh: '同步旁白' }, body: { en: 'Keep microphone audio aligned with the whiteboard timeline.', zh: '让麦克风音频与白板时间线保持对齐。' } },
      { title: { en: 'Edit the explanation', zh: '编辑讲解' }, body: { en: 'Trim, split, delete, and adjust focus regions around the same source.', zh: '围绕同一来源裁剪、分割、删除并调整焦点区域。' } },
      { title: { en: 'Render the destination format', zh: '渲染目标格式' }, body: { en: 'Replay the source into the chosen dimensions and export locally.', zh: '将来源重放到所选尺寸并在本地导出。' } },
    ],
    facts: [
      { label: { en: 'Term ownership', zh: '术语边界' }, value: { en: '“Event-based recording” is used here to describe Excalicast’s whiteboard workflow.', zh: '“事件式录制”在此用于描述 Excalicast 的白板工作流。' } },
      { label: { en: 'Stored meaning', zh: '保留内容' }, value: { en: 'Ordered canvas operations, timing, narration, and editing decisions.', zh: '有序画布操作、时间、旁白和编辑决策。' } },
      { label: { en: 'Different source', zh: '其他来源' }, value: { en: 'Tab, window, and desktop modes use browser display capture.', zh: '标签页、窗口和桌面模式使用浏览器显示采集。' } },
    ],
    limitations: [
      { en: 'This is not a universal industry standard or a claim about every recording mode.', zh: '它不是统一行业标准，也不是对所有录制模式的概括。' },
      { en: 'A minimized browser can affect real-time browser execution; the operation stream prevents unrelated screen pixels from entering the whiteboard export but does not remove browser runtime constraints.', zh: '浏览器最小化可能影响实时执行；操作流能避免无关屏幕像素进入白板导出，但不能消除浏览器运行时限制。' },
    ],
    sources: [
      { label: { en: 'MDN: Screen Capture API', zh: 'MDN：屏幕捕获 API' }, url: 'https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API' },
      { label: { en: 'Excalidraw data format documentation', zh: 'Excalidraw 数据格式文档' }, url: 'https://docs.excalidraw.com/docs/codebase/json-schema' },
      PRODUCT_SOURCE,
    ],
    verifiedAt: '2026-08-26',
    updatedAt: '2026-08-26',
    faqs: [
      { q: { en: 'Is event-based recording the same as screen recording?', zh: '事件式录制等同于屏幕录制吗？' }, a: { en: 'No. Screen capture records a displayed video stream. Excalicast’s event-based whiteboard mode records structured whiteboard changes and uses them as the render source.', zh: '不等同。屏幕采集记录显示视频流；Excalicast 的事件式白板模式记录结构化白板变化，并以此作为渲染来源。' } },
      { q: { en: 'Does every Excalicast source use an operation stream?', zh: 'Excalicast 的所有来源都使用操作流吗？' }, a: { en: 'No. The whiteboard source uses the operation-stream model. Browser-tab, app-window, and desktop sources use display capture.', zh: '不是。白板来源使用操作流模型；浏览器标签页、应用窗口和桌面来源使用显示采集。' } },
    ],
    related: [
      { type: 'pillar', slug: 'excalidraw-recorder' },
      { type: 'pillar', slug: 'whiteboard-recorder' },
      { type: 'blog', slug: 'record-whiteboard-without-screen-recording' },
    ],
    ctaPreset: { label: { en: 'Try event-based whiteboard recording', zh: '体验事件式白板录制' }, href: '/app?source=whiteboard' },
  },
];

export function getPillarEntry(slug: string): PillarEntry | undefined {
  return PILLAR_ENTRIES.find((entry) => entry.slug === slug);
}
