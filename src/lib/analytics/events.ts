// 关键用户事件白名单 —— 单一事件名来源（客户端 trackEvent + 服务端校验 + Dashboard 漏斗共用）。

export const KNOWN_EVENTS = [
  // 页面旅程（仅聚合路径与停留时长，不采集页面内容或个人信息）
  'page_view',
  'journey_leave',
  // 转化 / CTA
  'cta_start_recording',
  'pricing_cta_click',
  'content_cta_click',
  'comparison_cta_click',
  'organic_landing_view',
  'content_page_view',
  'comparison_view',
  'view_demo',
  'feature_click',
  'upgrade_modal_open',
  'checkout_start',
  'purchase_success',
  // 录制生命周期
  'recording_start',
  'recording_setup_open',
  'recording_source_selected',
  'recording_complete',
  'recording_discard',
  'export_success',
  'subtitle_generate',
  'handout_generate',
  'share_create',
  // 账号
  'signup',
  'login',
  // 录制库
  'library_view',
  'library_search',
  'library_filter',
] as const;

export type KnownEvent = (typeof KNOWN_EVENTS)[number];

export const KNOWN_EVENT_SET: ReadonlySet<string> = new Set(KNOWN_EVENTS);

/** 漏斗顺序（Dashboard 用）：每一级取独立用户数。 */
export const FUNNEL_STEPS: KnownEvent[] = [
  'organic_landing_view',
  'content_cta_click',
  'recording_setup_open',
  'recording_source_selected',
  'recording_start',
  'recording_complete',
  'export_success',
];
